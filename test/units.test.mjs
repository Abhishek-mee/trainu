import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanTitle,
  contentDisposition,
  episodeLabel,
  formatBytes,
  formatClock,
  isVideoFile,
  mimeFor,
  staticMimeFor,
} from '../src/paths.mjs';
import { parseRange, srtToVtt } from '../src/media.mjs';
import { isLoopback, parseCookies } from '../src/http-util.mjs';
import { languageLabel } from '../src/library.mjs';
import { enableAdbReverse, parseAdbDevices } from '../src/usb.mjs';

test('parseRange handles the ranges browsers send', () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange('bytes=0-99', 100), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=50-', 100), { start: 50, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=0-999', 100), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=5-2', 100), { invalid: true });
  assert.deepEqual(parseRange('bytes=100-', 100), { invalid: true });
  assert.deepEqual(parseRange('bytes=abc', 100), { invalid: true });
  assert.deepEqual(parseRange('items=0-1', 100), { invalid: true });
  assert.deepEqual(parseRange('bytes=0-1,5-6', 100), null);
  assert.deepEqual(parseRange('bytes=0-1', 0), { invalid: true });
});

test('srtToVtt converts timing and drops numeric counters', () => {
  const vtt = srtToVtt('\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03.000 --> 00:00:04.000\r\n<i>Bye</i>\r\n');
  assert.match(vtt, /^WEBVTT\n\n/);
  assert.match(vtt, /00:00:01\.000 --> 00:00:02\.500/);
  assert.match(vtt, /Hello/);
  assert.match(vtt, /<i>Bye<\/i>/);
  assert.doesNotMatch(vtt, /^1$/m);
});

test('titles and episode labels stay readable', () => {
  assert.equal(cleanTitle('Inception.2010.1080p.BluRay.x264-GROUP.mkv'), 'Inception 2010');
  assert.equal(cleanTitle('Show.S01E02.1080p.WEB-DL.mkv'), 'Show S01E02');
  assert.equal(cleanTitle('A Movie (2024) [2160p].mkv'), 'A Movie (2024)');
  assert.equal(episodeLabel('Show.S01E02.1080p.mkv'), 'S01E02');
  assert.equal(episodeLabel('Show 2x07.mkv'), 'S02E07');
  assert.equal(episodeLabel('Movie 2024.mkv'), '');
  assert.equal(languageLabel('en'), 'English');
  assert.equal(languageLabel('forced'), 'Forced');
  assert.equal(languageLabel('pt-BR'), 'Pt Br');
});

test('formatting helpers', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(3661), '1:01:01');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 ** 3 * 2.5), '2.5 GB');
});

test('MIME and media extension helpers', () => {
  assert.equal(mimeFor('clip.MKV'), 'video/x-matroska');
  assert.equal(mimeFor('clip.webm'), 'video/webm');
  assert.equal(mimeFor('clip.unknown'), 'application/octet-stream');
  assert.equal(staticMimeFor('app.js'), 'text/javascript; charset=utf-8');
  assert.equal(staticMimeFor('manifest.webmanifest'), 'application/manifest+json; charset=utf-8');
  assert.equal(isVideoFile('movie.MP4'), true);
  assert.equal(isVideoFile('movie.txt'), false);
  assert.match(contentDisposition('A "movie".mp4'), /^inline; filename="A _movie_.mp4"; filename\*=UTF-8''/);
});

test('adb device output keeps unauthorized and model details', () => {
  const devices = parseAdbDevices([
    'List of devices attached',
    'c5c8e1cb device product:spring_p_in model:25057PC09I device:spring transport_id:8',
    'R58M123 unauthorized usb:1-1 transport_id:2',
    'emulator-5554 offline',
    'XYZ no permissions (user in plugdev group); see [http://developer.android.com/tools/device.html]',
    '',
  ].join('\r\n'));

  assert.equal(devices.length, 4);
  assert.deepEqual(devices[0], {
    serial: 'c5c8e1cb',
    state: 'device',
    model: '25057PC09I',
    product: 'spring_p_in',
    transportId: '8',
  });
  assert.equal(devices[1].state, 'unauthorized');
  assert.equal(devices[1].model, '');
  assert.equal(devices[2].state, 'offline');
  assert.equal(devices[3].state, 'no-permissions');
});

test('usb connect waits for the Android prompt and sets reverse', async () => {
  const calls = [];
  let polls = 0;
  const runner = async (command, args) => {
    calls.push(args);
    if (args[0] === 'devices') {
      polls += 1;
      const stdout = polls < 2
        ? 'List of devices attached\nPHONE1 unauthorized usb:1-1\n'
        : 'List of devices attached\nPHONE1 device product:test model:Pixel_7 device:test transport_id:1\n';
      return { ok: true, stdout, stderr: '' };
    }
    return { ok: true, stdout: '', stderr: '' };
  };

  const result = await enableAdbReverse(8765, {
    waitMs: 600,
    finder: () => 'C:\\fake\\adb.exe',
    runner,
  });

  assert.equal(result.ok, true);
  assert.equal(result.restarted, true);
  assert.equal(result.devices[0].model, 'Pixel 7');
  assert.ok(calls.some((args) => args.includes('kill-server')));
  assert.ok(calls.some((args) => args.includes('reverse')
    && args.includes('tcp:8765')
    && args.includes('PHONE1')));
});

test('usb connect explains missing adb and missing phone', async () => {
  const missing = await enableAdbReverse(8765, { finder: () => null });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'no-adb');
  assert.match(missing.message, /platform-tools|ADB_PATH/);

  const noPhone = await enableAdbReverse(8765, {
    waitMs: 0,
    finder: () => 'C:\\fake\\adb.exe',
    runner: async (command, args) => ({
      ok: true,
      stdout: args[0] === 'devices' ? 'List of devices attached\n\n' : '',
      stderr: '',
    }),
  });
  assert.equal(noPhone.ok, false);
  assert.equal(noPhone.reason, 'no-device');
  assert.match(noPhone.message, /USB debugging|File transfer/);
});

test('cookies and loopback detection', () => {
  assert.deepEqual(parseCookies('a=1; trainu_key=A1B2C3D4; broken'), {
    a: '1',
    trainu_key: 'A1B2C3D4',
  });
  assert.equal(isLoopback({ socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: '::1' } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: '192.168.1.20' } }), false);
});
