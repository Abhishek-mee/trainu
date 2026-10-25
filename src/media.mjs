import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { contentDisposition, mimeFor } from './paths.mjs';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const MAX_CONVERSIONS = 2;
const WEB_VIDEO_CODECS = new Set(['h264', 'av1', 'vp9', 'vp8']);
const WEB_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

/**
 * Parse a Range header.
 * @returns {null | {invalid: true} | {start: number, end: number}}
 * null means "send the whole file".
 */
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^\s*bytes\s*=\s*(.+)$/i.exec(String(header));
  if (!match) return { invalid: true };
  if (!Number.isFinite(size) || size <= 0) return { invalid: true };

  const specs = match[1].split(',').map((part) => part.trim()).filter(Boolean);
  // Multi-range responses require multipart/byteranges. Browsers send a single
  // range for video, so answering with the full file is the safest fallback.
  if (specs.length !== 1) return null;
  const spec = specs[0];
  if (!/^\d*-\d*$/.test(spec)) return { invalid: true };

  const [startText, endText] = spec.split('-');
  if (!startText && !endText) return { invalid: true };

  let start;
  let end;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return { invalid: true };
    if (start > end || start >= size) return { invalid: true };
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

/** Convert SubRip to WebVTT without pulling in a dependency. */
export function srtToVtt(input) {
  let text = String(input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  text = text.replace(/(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})/g, '$1.$2');
  const blocks = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    let lines = current;
    if (lines.length && /^\d+$/.test(lines[0].trim())) lines = lines.slice(1);
    if (lines.length && lines.some((line) => line.includes('-->'))) blocks.push(lines.join('\n'));
    current = [];
  };
  for (const line of text.split('\n')) {
    if (line.trim() === '') flush();
    else current.push(line);
  }
  flush();
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

/**
 * Stream a file with HTTP range support. Sets all headers itself.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function streamMedia(req, res, { filePath, stat, fileName, cacheControl = 'private, max-age=0, must-revalidate' }) {
  const size = stat.size;
  const etag = `W/"${size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const type = mimeFor(fileName);
  const lastModified = new Date(stat.mtimeMs).toUTCString();

  const commonHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': type,
    'Last-Modified': lastModified,
    ETag: etag,
    'Cache-Control': cacheControl,
    'Content-Disposition': contentDisposition(fileName),
    'X-Content-Type-Options': 'nosniff',
  };

  const range = parseRange(req.headers.range, size);
  if (range && range.invalid) {
    res.writeHead(416, {
      ...commonHeaders,
      'Content-Range': `bytes */${size}`,
      'Content-Length': '0',
    });
    res.end();
    return;
  }

  if (!range && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl });
    res.end();
    return;
  }

  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      ...commonHeaders,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Content-Length': String(length),
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end, highWaterMark: 256 * 1024 });
    await pipeToResponse(stream, res);
    return;
  }

  res.writeHead(200, { ...commonHeaders, 'Content-Length': String(size) });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 });
  await pipeToResponse(stream, res);
}

async function pipeToResponse(stream, res) {
  try {
    await pipeline(stream, res);
  } catch (error) {
    if (!res.destroyed) res.destroy(error);
  }
}

function existsSync(candidate) {
  try {
    fs.accessSync(candidate);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(command) {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir.replace(/^"|"$/g, ''), `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Locate ffmpeg/ffprobe from config, env or common install locations. */
export function findFfmpeg(configuredPath = '') {
  const candidates = [];
  const add = (value) => {
    if (value) candidates.push(path.resolve(String(value).replace(/^"|"$/g, '')));
  };
  add(configuredPath);
  add(process.env.FFMPEG_PATH);

  // A copy kept inside the project works without PATH or panel setup.
  const localBinary = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  add(path.join(PROJECT_ROOT, 'tools', 'ffmpeg', 'bin', localBinary));
  add(path.join(PROJECT_ROOT, 'tools', 'ffmpeg', localBinary));
  add(path.join(PROJECT_ROOT, 'tools', 'bin', localBinary));

  if (process.platform === 'win32') {
    add(path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
    add('C:\\ffmpeg\\bin\\ffmpeg.exe');
    add(path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'chocolatey', 'bin', 'ffmpeg.exe'));
    add('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe');
  } else {
    add('/usr/bin/ffmpeg');
    add('/usr/local/bin/ffmpeg');
    add('/opt/homebrew/bin/ffmpeg');
  }
  const onPath = findOnPath('ffmpeg');
  if (onPath) add(onPath);

  for (const candidate of candidates) {
    let ffmpegPath = candidate;
    try {
      if (fs.statSync(candidate).isDirectory()) ffmpegPath = path.join(candidate, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    } catch {
      continue;
    }
    if (!existsSync(ffmpegPath)) continue;
    const probeCandidate = path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    const result = spawnSync(ffmpegPath, ['-version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (result.error || result.status !== 0) continue;
    const version = `${result.stdout ?? ''}`.split('\n')[0].trim();
    return {
      available: true,
      ffmpegPath,
      ffprobePath: existsSync(probeCandidate) ? probeCandidate : null,
      version,
    };
  }
  return { available: false, ffmpegPath: null, ffprobePath: null, version: null };
}

function run(command, args, { timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, stdout, stderr: `${stderr}\nTimed out after ${timeout}ms` });
    }, timeout);
    timer.unref?.();
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish({ ok: false, stdout, stderr: error.message }));
    child.on('close', (code) => finish({ ok: code === 0, code, stdout, stderr }));
  });
}

/**
 * Owns ffmpeg discovery, metadata cache, thumbnail cache and live conversion.
 */
export class MediaTools {
  constructor({ dataDir, configStore, log }) {
    this.dataDir = dataDir;
    this.configStore = configStore;
    this.log = log;
    this.metaFile = path.join(dataDir, 'meta.json');
    this.thumbsDir = path.join(dataDir, 'thumbs');
    this.meta = {};
    this.ffmpeg = { available: false, ffmpegPath: null, ffprobePath: null, version: null };
    this.activeConversions = 0;
    this._thumbLocks = new Map();
    this._thumbQueue = [];
    this._thumbActive = 0;
    this._thumbMax = 2;
    this._saveTimer = null;
    this._write = Promise.resolve();
    this._probeWarned = false;
  }

  async init() {
    await fsp.mkdir(this.thumbsDir, { recursive: true });
    try {
      const raw = await fsp.readFile(this.metaFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') this.meta = parsed;
    } catch {
      // A missing or unreadable cache is not an error.
    }
    this.detect();
    return this;
  }

  detect() {
    this.ffmpeg = findFfmpeg(this.configStore?.value?.ffmpegPath ?? '');
    if (this.ffmpeg.available) {
      this.log.info('ffmpeg ready', { version: this.ffmpeg.version, path: this.ffmpeg.ffmpegPath });
    } else {
      this.log.warn('ffmpeg not found; thumbnails and format conversion are disabled');
    }
    return this.ffmpeg;
  }

  get available() {
    return this.ffmpeg.available;
  }

  get canProbe() {
    return Boolean(this.ffmpeg.available && this.ffmpeg.ffprobePath);
  }

  thumbPath(id) {
    return path.join(this.thumbsDir, `${id}.jpg`);
  }

  thumbExists(id) {
    return existsSync(this.thumbPath(id));
  }

  /** Cached probe data for a file, invalidated by size or mtime changes. */
  metaFor({ id, size, mtimeMs }) {
    const cached = this.meta[id];
    if (!cached) return null;
    if (cached.size !== size || Math.abs(cached.mtimeMs - mtimeMs) > 1500) return null;
    return cached;
  }

  setMeta(id, size, mtimeMs, data) {
    this.meta[id] = {
      size,
      mtimeMs,
      duration: Number.isFinite(data.duration) ? data.duration : null,
      width: data.width ?? null,
      height: data.height ?? null,
      vcodec: data.vcodec ?? null,
      acodec: data.acodec ?? null,
      updated: Date.now(),
    };
    this._scheduleSave();
  }

  recordDuration(id, duration, item) {
    if (!Number.isFinite(duration) || duration <= 1) return;
    const current = this.meta[id];
    if (current?.duration && Math.abs(current.duration - duration) < 2) return;
    this.setMeta(id, item.size, item.mtimeMs, { ...(current ?? {}), duration });
  }

  async probeFile(filePath) {
    if (!this.canProbe) return null;
    const result = await run(this.ffmpeg.ffprobePath, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ], { timeout: 25000 });
    if (!result.ok) return null;
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return null;
    }
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    const duration = Number(parsed.format?.duration ?? video?.duration);
    return {
      duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 10) / 10 : null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      vcodec: video?.codec_name ?? null,
      acodec: audio?.codec_name ?? null,
    };
  }

  /**
   * Probe a batch of items in the background, reporting each result.
   * @param {any[]} items
   * @param {(item: any, meta: any) => void} onUpdate
   */
  async enrich(items, onUpdate) {
    if (!this.canProbe) return;
    const pending = items.filter((item) => !this.metaFor(item));
    if (!pending.length) return;
    const limit = pending.slice(0, 4000);
    this.log.scan('Reading media metadata', { files: limit.length });
    let cursor = 0;
    let done = 0;
    const worker = async () => {
      while (cursor < limit.length) {
        const item = limit[cursor++];
        this.metaFor(item); // cheap validity check
        const meta = await this.probeFile(item.filePath);
        if (!meta) continue;
        this.setMeta(item.id, item.size, item.mtimeMs, meta);
        done += 1;
        if (done % 25 === 0) this.log.scan('Metadata progress', { done, total: limit.length });
        onUpdate?.(item, meta);
      }
    };
    const workers = Array.from({ length: Math.min(3, limit.length) }, worker);
    await Promise.all(workers);
    this.log.scan('Metadata finished', { files: done });
  }

  /**
   * Create (or reuse) a JPEG poster frame. Returns a file path or null.
   * @param {any} item
   */
  async thumbnail(item) {
    if (!this.ffmpeg.available) return null;
    const target = this.thumbPath(item.id);
    if (existsSync(target)) return target;
    if (this._thumbLocks.has(item.id)) return this._thumbLocks.get(item.id);

    const job = (async () => {
      await this._acquireThumbSlot();
      try {
        // Another request may have generated it while this one waited in line.
        if (existsSync(target)) return target;
        const at = item.duration && item.duration > 20 ? Math.min(60, item.duration * 0.1) : 4;
        const tmp = `${target}.${process.pid}.tmp.jpg`;
        const result = await run(this.ffmpeg.ffmpegPath, [
          '-hide_banner', '-loglevel', 'error', '-nostdin',
          '-ss', String(Math.max(0, at)),
          '-i', item.filePath,
          '-frames:v', '1',
          '-vf', "scale='min(720,iw)':-2",
          '-q:v', '4',
          '-y', tmp,
        ], { timeout: 30000 });
        if (!result.ok) {
          await fsp.rm(tmp, { force: true }).catch(() => {});
          return null;
        }
        try {
          const stat = await fsp.stat(tmp);
          if (stat.size < 300) {
            await fsp.rm(tmp, { force: true }).catch(() => {});
            return null;
          }
          await fsp.rename(tmp, target);
          return target;
        } catch {
          return null;
        }
      } finally {
        this._releaseThumbSlot();
      }
    })().finally(() => this._thumbLocks.delete(item.id));

    this._thumbLocks.set(item.id, job);
    return job;
  }

  _acquireThumbSlot() {
    if (this._thumbActive < this._thumbMax) {
      this._thumbActive += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._thumbQueue.push(() => {
        this._thumbActive += 1;
        resolve();
      });
    });
  }

  _releaseThumbSlot() {
    this._thumbActive = Math.max(0, this._thumbActive - 1);
    const next = this._thumbQueue.shift();
    if (next) next();
  }

  /** True when ffmpeg can copy streams without re-encoding. */
  canCopy(item) {
    const meta = this.metaFor(item);
    if (!meta?.vcodec || !meta?.acodec) return false;
    return WEB_VIDEO_CODECS.has(meta.vcodec) && WEB_AUDIO_CODECS.has(meta.acodec);
  }

  buildConvertArgs(item, { start = 0, copy = false } = {}) {
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    if (Number.isFinite(start) && start > 0) {
      args.push('-ss', start.toFixed(3));
    }
    args.push('-i', item.filePath, '-sn', '-dn', '-map', '0:v:0', '-map', '0:a:0?');
    if (copy) {
      args.push('-c', 'copy');
    } else {
      args.push(
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-profile:v', 'main',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-ac', '2',
      );
    }
    // Fragmented MP4 can be written to a pipe and starts playing immediately.
    args.push(
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      'pipe:1',
    );
    return args;
  }

  /**
   * Pipe a converted MP4 into an HTTP response.
   * @returns {Promise<void>}
   */
  async convertToResponse(item, res, { start = 0, copy = false } = {}) {
    if (!this.ffmpeg.available) throw Object.assign(new Error('ffmpeg is required for conversion'), { statusCode: 501 });
    if (this.activeConversions >= MAX_CONVERSIONS) {
      throw Object.assign(new Error('The laptop is already converting two videos'), { statusCode: 429 });
    }
    this.activeConversions += 1;
    const args = this.buildConvertArgs(item, { start, copy });
    const child = spawn(this.ffmpeg.ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 8000) stderr += chunk;
    });
    const stop = () => {
      if (!child.killed) child.kill('SIGKILL');
    };
    res.on('close', () => {
      if (!res.writableEnded) stop();
    });
    try {
      await pipeline(child.stdout, res);
    } catch {
      if (!res.destroyed) res.destroy();
    } finally {
      this.activeConversions -= 1;
      stop();
    }
    if (stderr.includes('Error') || stderr.includes('error')) {
      this.log.warn('Conversion failed', { file: item.file, error: stderr.slice(-400) });
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.flush().catch(() => {});
    }, 800);
    this._saveTimer.unref?.();
  }

  async flush() {
    const write = async () => {
      const tmp = `${this.metaFile}.tmp`;
      await fsp.writeFile(tmp, `${JSON.stringify(this.meta)}\n`, 'utf8');
      await fsp.rename(tmp, this.metaFile);
    };
    this._write = this._write.then(write, write);
    await this._write;
  }

  status() {
    return {
      available: this.ffmpeg.available,
      version: this.ffmpeg.version,
      path: this.ffmpeg.ffmpegPath,
      ffprobe: Boolean(this.ffmpeg.ffprobePath),
      probed: Object.keys(this.meta).length,
      activeConversions: this.activeConversions,
    };
  }
}
