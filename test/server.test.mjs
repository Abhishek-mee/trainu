import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import zlib from 'node:zlib';
import {
  TOKEN,
  cookieHeaderFrom,
  rawRequest,
  request,
  startTrainu,
} from './helpers.mjs';

let app;
let phone;
let bootCookie = '';
let phoneCookie = '';
let pairResponse;
let mp4Item;
let mkvItem;

before(async () => {
  app = await startTrainu();
  phone = await startTrainu({ localCheck: () => false });

  pairResponse = await request(phone.base, `/pair?t=${TOKEN}`);
  phoneCookie = cookieHeaderFrom(pairResponse);

  const library = await request(app.base, '/api/library');
  bootCookie = cookieHeaderFrom(library);
  const payload = JSON.parse(library.text);
  mp4Item = payload.items.find((item) => item.file === 'Test Movie.mp4');
  mkvItem = payload.items.find((item) => item.file === 'Show S01E02.mkv');
});

after(async () => {
  await phone?.close();
  await app?.close();
});

test('library response is complete and does not expose filesystem paths', async () => {
  const response = await request(app.base, '/api/library', { headers: { cookie: bootCookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');

  const data = JSON.parse(response.text);
  assert.equal(data.app, 'trainu');
  assert.equal(data.name, 'Test Library');
  assert.equal(data.count, 3);
  assert.equal(data.totalBytes, 4096 + 2048 + 1024);
  assert.equal(data.folders.length, 1);
  assert.equal(data.folders[0].count, 3);
  assert.equal(data.ffmpeg, false);
  assert.equal(data.transcoding, false);
  assert.ok(data.revision >= 1);
  assert.match(data.deviceId, /^[a-f0-9]{16}$/);

  assert.ok(mp4Item);
  assert.equal(mp4Item.title, 'Test Movie');
  assert.equal(mp4Item.direct, true);
  assert.equal(mp4Item.collection, 'Videos');
  assert.equal(mp4Item.subtitles.length, 1);
  assert.equal(mp4Item.subtitles[0].lang, 'en');
  assert.equal(mp4Item.subtitles[0].label, 'English');
  assert.equal('filePath' in mp4Item, false);
  assert.equal(response.text.includes(app.mediaDir), false);

  assert.ok(mkvItem);
  assert.equal(mkvItem.direct, false);
  assert.equal(mkvItem.directReason, 'container');
  assert.equal(mkvItem.collection, 'Shows');
  assert.equal(mkvItem.episode, 'S01E02');
});

test('library JSON is gzipped when the client accepts it', async () => {
  const response = await rawRequest(app.base, '/api/library', {
    'accept-encoding': 'gzip',
    connection: 'close',
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-encoding'], 'gzip');
  assert.equal(response.headers.vary, 'Accept-Encoding');
  const parsed = JSON.parse(zlib.gunzipSync(response.buffer).toString('utf8'));
  assert.equal(parsed.count, 3);
  assert.equal(response.buffer[0], 0x1f);
  assert.equal(response.buffer[1], 0x8b);
});

test('media streams with byte ranges and cache validators', async () => {
  const full = await request(app.base, `/media/${mp4Item.id}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(Number(full.headers.get('content-length')), 4096);
  assert.match(full.headers.get('content-disposition'), /^inline;/);
  const original = await fs.readFile(app.files.mp4);
  assert.deepEqual(full.buffer, original);

  const partial = await request(app.base, `/media/${mp4Item.id}`, {
    headers: { range: 'bytes=100-199' },
  });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 100-199/4096');
  assert.equal(partial.buffer.length, 100);
  assert.deepEqual(partial.buffer, original.subarray(100, 200));

  const suffix = await request(app.base, `/media/${mp4Item.id}`, {
    headers: { range: 'bytes=-12' },
  });
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get('content-range'), 'bytes 4084-4095/4096');
  assert.deepEqual(suffix.buffer, original.subarray(-12));

  const invalid = await request(app.base, `/media/${mp4Item.id}`, {
    headers: { range: 'bytes=9000-' },
  });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('content-range'), 'bytes */4096');
  assert.equal(invalid.buffer.length, 0);

  const head = await request(app.base, `/media/${mp4Item.id}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.buffer.length, 0);
  assert.equal(Number(head.headers.get('content-length')), 4096);

  const rangedHead = await request(app.base, `/media/${mp4Item.id}`, {
    method: 'HEAD',
    headers: { range: 'bytes=0-9' },
  });
  assert.equal(rangedHead.status, 206);
  assert.equal(rangedHead.buffer.length, 0);
  assert.equal(Number(rangedHead.headers.get('content-length')), 10);

  const etag = full.headers.get('etag');
  assert.ok(etag);
  const cached = await request(app.base, `/media/${mp4Item.id}`, {
    headers: { 'if-none-match': etag },
  });
  assert.equal(cached.status, 304);
  assert.equal(cached.buffer.length, 0);

  const matroska = await request(app.base, `/media/${mkvItem.id}`);
  assert.equal(matroska.status, 200);
  assert.equal(matroska.headers.get('content-type'), 'video/x-matroska');

  const missing = await request(app.base, '/media/0123456789abcdef');
  assert.equal(missing.status, 404);
  assert.equal(JSON.parse(missing.text).error, 'not-found');
});

test('subtitles are converted to WebVTT', async () => {
  const response = await request(app.base, `/api/subtitle/${mp4Item.id}/0.vtt`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/vtt/);
  assert.match(response.text, /^WEBVTT/);
  assert.match(response.text, /00:00:01\.000 --> 00:00:02\.000/);
  assert.match(response.text, /Hello from Trainu/);
  assert.doesNotMatch(response.text, /00:00:01,000/);

  const missing = await request(app.base, `/api/subtitle/${mp4Item.id}/9.vtt`);
  assert.equal(missing.status, 404);
});

test('watch progress round-trips per device', async () => {
  const started = await request(app.base, '/api/progress', {
    method: 'POST',
    headers: { cookie: bootCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ id: mp4Item.id, position: 25.55, duration: 100 }),
  });
  assert.equal(started.status, 200);
  const saved = JSON.parse(started.text);
  assert.equal(saved.ok, true);
  assert.equal(Math.round(saved.progress.pos * 10) / 10, 25.6);

  let library = JSON.parse((await request(app.base, '/api/library', {
    headers: { cookie: bootCookie },
  })).text);
  let progress = library.items.find((item) => item.id === mp4Item.id).progress;
  assert.ok(progress);
  assert.equal(progress.pos, saved.progress.pos);
  assert.equal(progress.dur, 100);
  assert.equal(progress.finished, false);

  await request(app.base, '/api/progress', {
    method: 'POST',
    headers: { cookie: bootCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ id: mp4Item.id, position: 100, duration: 100 }),
  });
  library = JSON.parse((await request(app.base, '/api/library', {
    headers: { cookie: bootCookie },
  })).text);
  progress = library.items.find((item) => item.id === mp4Item.id).progress;
  assert.equal(progress.finished, true);

  const cleared = await request(app.base, '/api/progress/clear', {
    method: 'POST',
    headers: { cookie: bootCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ all: true }),
  });
  assert.equal(cleared.status, 200);
  library = JSON.parse((await request(app.base, '/api/library', {
    headers: { cookie: bootCookie },
  })).text);
  assert.equal(library.items.find((item) => item.id === mp4Item.id).progress, null);

  const invalidItem = await request(app.base, '/api/progress', {
    method: 'POST',
    headers: { cookie: bootCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'ffffffffffffffff', position: 4, duration: 10 }),
  });
  assert.equal(invalidItem.status, 404);

  const wrongMethod = await request(app.base, '/api/progress', {
    headers: { cookie: bootCookie },
  });
  assert.equal(wrongMethod.status, 405);
});

test('static assets and the local control panel are served', async () => {
  const home = await request(app.base, '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /^text\/html/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(home.text, /id="player"/);
  assert.match(home.text, /manifest\.webmanifest/);

  const desktop = await request(app.adminBase, '/desktop');
  assert.equal(desktop.status, 200);
  assert.match(desktop.text, /Laptop panel/);

  const mainDesktop = await request(app.base, '/desktop');
  assert.equal(mainDesktop.status, 302);
  assert.equal(mainDesktop.location, `http://127.0.0.1:${app.server.adminPort}/desktop`);

  const css = await request(app.base, '/css/app.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /^text\/css/);
  assert.match(css.headers.get('cache-control'), /no-cache/);

  const manifest = await request(app.base, '/manifest.webmanifest');
  assert.equal(manifest.status, 200);
  assert.equal(JSON.parse(manifest.text).short_name, 'Trainu');

  const sw = await request(app.base, '/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /^text\/javascript/);

  const favicon = await request(app.base, '/favicon.svg');
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get('content-type'), /^image\/svg\+xml/);

  const icon = await request(app.base, '/icons/icon-192.png');
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/png');
  assert.deepEqual([...icon.buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const missing = await request(app.base, '/css/not-here.css');
  assert.equal(missing.status, 404);
});

test('pair page is public and wrong codes show an error', async () => {
  const page = await request(phone.base, '/pair');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(page.text, /Connect this phone/);
  assert.match(page.text, new RegExp(`127\\.0\\.0\\.1:${phone.server.adminPort}/desktop`));
  assert.equal(page.text.includes(`127.0.0.1:${phone.port}/desktop`), false);
  assert.match(page.text, /<script src="\/js\/pair\.js" defer><\/script>/);
  assert.equal(page.text.includes('That code did not match'), false);
  assert.equal(page.text.includes('<!--PAIR_ERROR-->'), false);
  assert.equal(page.text.includes('<!--PANEL_URL-->'), false);

  const wrong = await request(phone.base, '/pair?t=DEADBEEF');
  assert.equal(wrong.status, 200);
  assert.match(wrong.text, /That code did not match/);
  assert.equal(wrong.cookies.length, 0);
});

test('a valid pairing link sets cookies and unlocks the phone', async () => {
  assert.equal(pairResponse.status, 302);
  assert.equal(pairResponse.location, '/');
  assert.match(phoneCookie, /trainu_key=A1B2C3D4/);
  assert.match(phoneCookie, /trainu_device=[a-f0-9]{16}/);

  const home = await request(phone.base, '/', { headers: { cookie: phoneCookie } });
  assert.equal(home.status, 200);

  const library = await request(phone.base, '/api/library', { headers: { cookie: phoneCookie } });
  assert.equal(library.status, 200);
  assert.equal(JSON.parse(library.text).count, 3);

  const info = await request(phone.base, '/api/info', { headers: { cookie: phoneCookie } });
  assert.equal(info.status, 200);
  const payload = JSON.parse(info.text);
  assert.match(payload.deviceId, /^[a-f0-9]{16}$/);
  assert.equal(payload.count, 3);
});

test('unpaired phones are blocked from APIs, media and admin', async () => {
  const api = await request(phone.base, '/api/library');
  assert.equal(api.status, 401);
  assert.equal(JSON.parse(api.text).error, 'pair-required');

  const media = await request(phone.base, `/media/${mp4Item.id}`);
  assert.equal(media.status, 401);

  const home = await request(phone.base, '/');
  assert.equal(home.status, 302);
  assert.equal(home.location, '/pair');

  const admin = await request(phone.base, '/api/admin/status');
  assert.equal(admin.status, 403);
  assert.equal(JSON.parse(admin.text).error, 'admin-local-only');

  const desktop = await request(phone.base, '/desktop');
  assert.equal(desktop.status, 403);

  const ping = await request(phone.base, '/api/ping');
  assert.equal(ping.status, 200);
  const payload = JSON.parse(ping.text);
  assert.equal(payload.ok, true);
  assert.equal(payload.paired, false);
});

test('a phone tunnelled through adb reverse cannot reach the control panel', async () => {
  // adb reverse makes the phone's requests arrive from 127.0.0.1, so the main
  // server treats them as local. Admin lives on a different loopback port that
  // the reverse rule does not expose.
  const tunnelled = await startTrainu({ localCheck: () => true });
  try {
    assert.notEqual(tunnelled.server.adminPort, tunnelled.port);
    assert.equal(tunnelled.server.adminServer.address().address, '127.0.0.1');

    const panel = await request(tunnelled.base, '/desktop');
    assert.equal(panel.status, 302);
    assert.equal(panel.location, `http://127.0.0.1:${tunnelled.server.adminPort}/desktop`);

    const api = await request(tunnelled.base, '/api/admin/status');
    assert.equal(api.status, 302);
    assert.equal(api.text, '');
    assert.equal(api.text.includes(TOKEN), false);

    const library = await request(tunnelled.base, '/api/library');
    assert.equal(library.status, 200);
    assert.equal(library.text.includes(TOKEN), false);

    const admin = await request(tunnelled.adminBase, '/api/admin/status');
    assert.equal(admin.status, 200);
    assert.equal(JSON.parse(admin.text).token, TOKEN);
  } finally {
    await tunnelled.close();
  }
});

test('only indexed media and sidecars are addressable', async () => {
  const library = JSON.parse((await request(app.base, '/api/library')).text);
  const serialised = JSON.stringify(library);
  assert.equal(serialised.includes(app.root), false);
  assert.equal(serialised.includes(app.dataDir), false);
  assert.equal(serialised.includes('notes.txt'), false);

  for (const target of [
    '/media/0000000000000000',
    '/media/notes.txt',
    `/media/${mp4Item.id}/extra`,
    '/api/subtitle/0000000000000000/0.vtt',
    '/api/thumbnails/0000000000000000.jpg',
    '/api/library/../config.json',
    '/api/files/config.json',
  ]) {
    const response = await request(app.base, target);
    assert.notEqual(response.status, 200, `${target} unexpectedly returned 200`);
    assert.equal(response.text.includes(app.root), false, `${target} leaked a filesystem path`);
  }
});

test('query tokens work without a cookie but static files stay public', async () => {
  const library = await request(phone.base, `/api/library?t=${TOKEN}`);
  assert.equal(library.status, 200);
  assert.match(library.text, /Test Movie/);
  assert.ok(library.cookies.some((cookie) => cookie.startsWith('trainu_key=')));

  const css = await request(phone.base, '/css/base.css');
  assert.equal(css.status, 200);
});

test('admin status reports paths, media state and token', async () => {
  const status = await request(app.adminBase, '/api/admin/status');
  assert.equal(status.status, 200);
  const data = JSON.parse(status.text);
  assert.equal(data.app, 'trainu');
  assert.equal(data.token, TOKEN);
  assert.equal(data.dataDir, app.dataDir);
  assert.equal(data.port, app.port);
  assert.equal(data.panelUrl, `http://127.0.0.1:${app.server.adminPort}/desktop`);
  assert.equal(data.phoneUrl, `http://127.0.0.1:${app.port}/`);
  assert.equal(data.library.count, 3);
  assert.equal(data.folders.length, 1);
  assert.equal(data.folders[0].exists, true);
  assert.equal(data.media.available, false);
  assert.equal(typeof data.adb.available, 'boolean');
  assert.ok(data.firewall === '' || data.firewall.includes('netsh'));
  assert.ok(Array.isArray(data.log));
});

test('admin can rename the library, add and remove folders', async () => {
  const rename = await request(app.adminBase, '/api/admin/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Renamed Library', autoScanMinutes: 0 }),
  });
  assert.equal(rename.status, 200);

  let status = JSON.parse((await request(app.adminBase, '/api/admin/status')).text);
  assert.equal(status.name, 'Renamed Library');

  const extraDir = path.join(app.root, 'extra');
  await fs.mkdir(extraDir, { recursive: true });
  const added = await request(app.adminBase, '/api/admin/folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: extraDir, label: 'Extra' }),
  });
  assert.equal(added.status, 200);
  const folder = JSON.parse(added.text).folder;
  assert.equal(folder.label, 'Extra');

  status = JSON.parse((await request(app.adminBase, '/api/admin/status')).text);
  assert.equal(status.folders.length, 2);

  const invalid = await request(app.adminBase, '/api/admin/folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: path.join(app.root, 'does-not-exist') }),
  });
  assert.equal(invalid.status, 400);

  const removed = await request(app.adminBase, `/api/admin/folders/${folder.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  status = JSON.parse((await request(app.adminBase, '/api/admin/status')).text);
  assert.equal(status.folders.length, 1);
});

test('path traversal attempts never return server files', async () => {
  for (const target of [
    '/css/%2e%2e/%2e%2e/package.json',
    '/css/..%5c..%5cpackage.json',
    '/vendor/..%5c..%5cpackage.json',
    '/media/..%2f..%2fpackage.json',
  ]) {
    const response = await request(app.base, target);
    assert.notEqual(response.status, 200, `${target} unexpectedly returned 200`);
    assert.equal(response.text.includes('"private": true'), false);
  }
});
