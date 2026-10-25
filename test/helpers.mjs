import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ConfigStore } from '../src/config.mjs';
import { Library } from '../src/library.mjs';
import { Log } from '../src/log.mjs';
import { MediaTools } from '../src/media.mjs';
import { ProgressStore } from '../src/progress.mjs';
import { TrainuServer } from '../src/server.mjs';

export const TOKEN = 'A1B2C3D4';
export const FOLDER_ID = 'aaaabbbb';

function sampleBytes(size, seed = 0) {
  const buffer = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) buffer[index] = (index * 7 + seed) % 251;
  return buffer;
}

/**
 * Start a real server against a throwaway library.
 * `localCheck` can simulate a phone by returning false for localhost requests.
 */
export async function startTrainu({ localCheck = () => true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trainu-test-'));
  const dataDir = path.join(root, 'data');
  const mediaDir = path.join(root, 'media');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(mediaDir, 'Shows'), { recursive: true });

  const files = {
    mp4: path.join(mediaDir, 'Test Movie.mp4'),
    mkv: path.join(mediaDir, 'Shows', 'Show S01E02.mkv'),
    avi: path.join(mediaDir, 'Old Clip.avi'),
    subtitle: path.join(mediaDir, 'Test Movie.en.srt'),
    ignored: path.join(mediaDir, 'notes.txt'),
  };
  await fs.writeFile(files.mp4, sampleBytes(4096, 3));
  await fs.writeFile(files.mkv, sampleBytes(2048, 11));
  await fs.writeFile(files.avi, sampleBytes(1024, 19));
  await fs.writeFile(files.ignored, 'not a video');
  await fs.writeFile(files.subtitle, '1\n00:00:01,000 --> 00:00:02,000\nHello from Trainu\n\n2\n00:00:03,500 --> 00:00:04,000\nSecond line\n');

  const config = {
    version: 1,
    name: 'Test Library',
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    folders: [{ id: FOLDER_ID, label: 'Videos', path: mediaDir, addedAt: Date.now() }],
    transcoding: true,
    ffmpegPath: '',
    autoScanMinutes: 0,
    createdAt: Date.now(),
  };
  await fs.writeFile(path.join(dataDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);

  const log = new Log({ silent: true });
  const configStore = new ConfigStore({ dataDir, log });
  await configStore.init();
  const mediaTools = await new MediaTools({ dataDir, configStore, log }).init();
  // Keep tests deterministic regardless of what is installed on the machine.
  mediaTools.ffmpeg = { available: false, ffmpegPath: null, ffprobePath: null, version: null };
  const progress = await new ProgressStore({ dataDir, log }).load();
  const library = new Library({ configStore, mediaTools, log });
  await library.scan({ reason: 'test' });

  const server = new TrainuServer({ configStore, library, mediaTools, progress, log, localCheck });
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const adminBase = `http://127.0.0.1:${server.adminPort}`;

  return {
    root,
    dataDir,
    mediaDir,
    files,
    configStore,
    mediaTools,
    progress,
    library,
    server,
    port,
    base,
    adminBase,
    async close() {
      await server.close();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

export async function request(base, pathname, { method = 'GET', headers = {}, body, redirect = 'manual' } = {}) {
  const response = await fetch(new URL(pathname, base), {
    method,
    redirect,
    headers: { 'accept-encoding': 'identity', ...headers },
    body,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    headers: response.headers,
    buffer,
    text: buffer.toString('utf8'),
    location: response.headers.get('location'),
    cookies: response.headers.getSetCookie?.() ?? [],
  };
}

export function cookieHeaderFrom(response) {
  const pairs = response.cookies
    .filter((cookie) => cookie.startsWith('trainu_key=') || cookie.startsWith('trainu_device='))
    .map((cookie) => cookie.split(';', 1)[0]);
  return pairs.join('; ');
}

export function rawRequest(base, pathname, headers = {}) {
  const url = new URL(pathname, base);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers,
      agent: false,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        buffer: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}
