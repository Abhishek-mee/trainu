import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PROJECT_ROOT, VERSION } from './config.mjs';
import {
  SECURITY_HEADERS,
  clientAddress,
  cookieHeader,
  htmlSecurityHeaders,
  isLoopback,
  parseCookies,
  readJson,
  redirect,
  sendJson,
  sendText,
  serveStatic,
} from './http-util.mjs';
import { randomId, contentDisposition } from './paths.mjs';
import { streamMedia, srtToVtt } from './media.mjs';
import { adbDevicesDetailed, adbReverseList, enableAdbReverse, findAdb, firewallCommand, networkUrls } from './usb.mjs';

const PUBLIC_PREFIXES = ['/css/', '/js/', '/icons/', '/vendor/'];
const PUBLIC_FILES = new Set(['/manifest.webmanifest', '/sw.js', '/favicon.ico', '/favicon.svg', '/pair.html', '/iso-local-link.svg']);
const ID_PATTERN = /^[a-f0-9]{16}$/;

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export class TrainuServer {
  /**
   * @param {{
   *   configStore: import('./config.mjs').ConfigStore,
   *   library: import('./library.mjs').Library,
   *   mediaTools: import('./media.mjs').MediaTools,
   *   progress: import('./progress.mjs').ProgressStore,
   *   log: import('./log.mjs').Log,
   *   publicDir?: string,
   *   localCheck?: (req: import('node:http').IncomingMessage) => boolean,
   * }} options
   */
  constructor({
    configStore,
    library,
    mediaTools,
    progress,
    log,
    publicDir = path.join(PROJECT_ROOT, 'public'),
    localCheck = isLoopback,
  }) {
    this.configStore = configStore;
    this.library = library;
    this.mediaTools = mediaTools;
    this.progress = progress;
    this.log = log;
    this.publicDir = publicDir;
    this.localCheck = localCheck;
    this.server = http.createServer((req, res) => this._handle(req, res));
    this.server.keepAliveTimeout = 65_000;
    // The control panel lives on its own loopback-only listener. adb reverse
    // forwards the phone port only, so a USB phone cannot reach this one even
    // though its tunnelled requests look like loopback traffic to the main server.
    this.adminServer = http.createServer((req, res) => this._handleAdmin(req, res));
    this.adminServer.keepAliveTimeout = 65_000;
    this.port = null;
    this.adminPort = null;
    this.startedAt = Date.now();
    this._adbCache = null;
    this._autoScanTimer = null;
    this._pairPage = null;
    this._closing = false;
  }

  async listen() {
    const config = this.configStore.value;
    const desired = config.port;
    let lastError = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = desired === 0 ? 0 : desired + attempt;
      try {
        await new Promise((resolve, reject) => {
          const onError = (error) => { this.server.off('listening', onListening); reject(error); };
          const onListening = () => { this.server.off('error', onError); resolve(); };
          this.server.once('error', onError);
          this.server.once('listening', onListening);
          this.server.listen(candidate, config.host);
        });
        this.port = this.server.address().port;
        if (this.port !== desired && desired !== 0) {
          this.log.warn('Default port was busy; using another one', { wanted: desired, port: this.port });
        }
        try {
          await this._listenAdmin();
        } catch (error) {
          await new Promise((resolve) => this.server.close(() => resolve()));
          throw error;
        }
        this._startAutoScan();
        return this.port;
      } catch (error) {
        lastError = error;
        if (error.code !== 'EADDRINUSE' || desired === 0) break;
      }
    }
    throw lastError ?? new Error('Could not start server');
  }

  async _listenAdmin() {
    await new Promise((resolve, reject) => {
      const onError = (error) => { this.adminServer.off('listening', onListening); reject(error); };
      const onListening = () => { this.adminServer.off('error', onError); resolve(); };
      this.adminServer.once('error', onError);
      this.adminServer.once('listening', onListening);
      this.adminServer.listen(0, '127.0.0.1');
    });
    this.adminPort = this.adminServer.address().port;
    this.log.info('Laptop control panel ready', { port: this.adminPort });
  }

  _startAutoScan() {
    const minutes = Number(this.configStore.value.autoScanMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    this._autoScanTimer = setInterval(() => {
      if (!this.library.scanning) {
        this.library.scan({ reason: 'auto' }).catch((error) => this.log.warn('Auto scan failed', { error: error.message }));
      }
    }, minutes * 60_000);
    this._autoScanTimer.unref?.();
  }

  async close() {
    this._closing = true;
    if (this._autoScanTimer) clearInterval(this._autoScanTimer);
    await Promise.all([this._closeServer(this.server), this._closeServer(this.adminServer)]);
    await this.progress.close().catch(() => {});
    await this.mediaTools.flush().catch(() => {});
  }

  _closeServer(server) {
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
      setTimeout(resolve, 1500).unref?.();
    });
  }

  get urls() {
    return networkUrls({ port: this.port, token: this.configStore.value.token });
  }

  get adminUrl() {
    return `http://127.0.0.1:${this.adminPort}/desktop`;
  }

  /* ------------------------------------------------------------------ */
  /* Request plumbing                                                    */
  /* ------------------------------------------------------------------ */

  async _handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');

    req.on('error', () => {});
    res.on('error', () => {});

    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = url.pathname;
      const cookies = parseCookies(req.headers.cookie);
      const local = this.localCheck(req);
      const token = this.configStore.value.token;
      const queryToken = url.searchParams.get('t');
      let authorized = local || safeEqual(cookies.trainu_key, token);
      if (!authorized && queryToken && safeEqual(queryToken, token)) authorized = true;

      // Keep a stable per-device id so resume positions follow the phone.
      let deviceId = /^[a-f0-9]{16,32}$/.test(cookies.trainu_device ?? '') ? cookies.trainu_device : null;
      const newCookies = [];
      if (authorized && !deviceId) {
        deviceId = randomId(8);
        newCookies.push(cookieHeader('trainu_device', deviceId));
      }
      if (authorized && queryToken && safeEqual(queryToken, token) && cookies.trainu_key !== token) {
        newCookies.push(cookieHeader('trainu_key', token));
      }
      if (newCookies.length) res.setHeader('Set-Cookie', newCookies);

      if (req.method === 'OPTIONS') {
        res.writeHead(204, SECURITY_HEADERS);
        res.end();
        return;
      }
      if (!['GET', 'HEAD', 'POST', 'DELETE'].includes(req.method)) {
        sendJson(res, 405, { error: 'method-not-allowed' });
        return;
      }

      // Pairing is the only page reachable without a paired cookie.
      if (pathname === '/pair') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method-not-allowed' });
          return;
        }
        if (queryToken && safeEqual(queryToken, token)) {
          const pairCookies = [cookieHeader('trainu_key', token)];
          if (!deviceId) deviceId = randomId(8);
          pairCookies.push(cookieHeader('trainu_device', deviceId));
          res.setHeader('Set-Cookie', pairCookies);
          this.log.info('Phone paired', { address: clientAddress(req) });
          redirect(res, '/');
          return;
        }
        await this._servePairPage(res, Boolean(queryToken));
        return;
      }

      // The control panel is served from a separate loopback-only port. This
      // main port is the one adb reverse exposes, so it must never serve admin.
      if (pathname === '/desktop' || pathname.startsWith('/api/admin/')) {
        if (!local) {
          sendJson(res, 403, { error: 'admin-local-only', message: 'Open the control panel on the laptop, using the URL printed by Trainu.' });
          return;
        }
        redirect(res, this.adminUrl);
        return;
      }

      if (PUBLIC_FILES.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
        if (pathname === '/sw.js' || pathname === '/manifest.webmanifest') {
          await serveStatic(req, res, this.publicDir, pathname);
          return;
        }
        const served = await serveStatic(req, res, this.publicDir, pathname);
        if (!served) sendText(res, 404, 'Not found');
        return;
      }

      if (pathname === '/api/ping') {
        sendJson(res, 200, {
          ok: true,
          app: 'trainu',
          version: VERSION,
          name: this.configStore.value.name,
          paired: authorized,
          scanning: this.library.scanning,
          transcoding: this.configStore.value.transcoding && this.mediaTools.available,
        });
        return;
      }

      if (!authorized) {
        if (pathname.startsWith('/api/') || pathname.startsWith('/media/')) {
          sendJson(res, 401, { error: 'pair-required', message: 'Open the pairing link shown on your laptop.' });
          return;
        }
        redirect(res, '/pair');
        return;
      }

      if (pathname === '/') {
        await serveStatic(req, res, this.publicDir, '/index.html');
        return;
      }

      if (pathname === '/api/library') {
        this._sendLibrary(res, deviceId);
        return;
      }

      const thumbMatch = /^\/api\/thumbnails\/([a-f0-9]{16})\.jpg$/.exec(pathname);
      if (thumbMatch) {
        await this._sendThumbnail(res, thumbMatch[1]);
        return;
      }

      const subtitleMatch = /^\/api\/subtitle\/([a-f0-9]{16})\/(\d+)\.vtt$/.exec(pathname);
      if (subtitleMatch) {
        await this._sendSubtitle(req, res, subtitleMatch[1], Number(subtitleMatch[2]));
        return;
      }

      const mediaMatch = /^\/media\/([a-f0-9]{16})$/.exec(pathname);
      if (mediaMatch) {
        await this._sendMedia(req, res, mediaMatch[1]);
        return;
      }

      const convertMatch = /^\/api\/convert\/([a-f0-9]{16})$/.exec(pathname);
      if (convertMatch) {
        await this._convert(req, res, url, convertMatch[1]);
        return;
      }

      if (pathname === '/api/progress') {
        await this._saveProgress(req, res, deviceId);
        return;
      }

      if (pathname === '/api/progress/clear') {
        await this._clearProgress(req, res, deviceId);
        return;
      }

      if (pathname === '/api/info' && req.method === 'GET') {
        sendJson(res, 200, {
          app: 'trainu',
          version: VERSION,
          name: this.configStore.value.name,
          transcoding: this.configStore.value.transcoding && this.mediaTools.available,
          deviceId,
          scanning: this.library.scanning,
          count: this.library.items.length,
        });
        return;
      }

      if (pathname.startsWith('/api/') || pathname.startsWith('/media/')) {
        sendJson(res, 404, { error: 'not-found' });
        return;
      }

      sendText(res, 404, 'Not found');
    } catch (error) {
      this._fail(req, res, error);
    }
  }

  _fail(req, res, error) {
    if (this._closing) return;
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (status >= 500) this.log.error('Request failed', { path: req.url, error: error.message });
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if ((req.url ?? '').startsWith('/api/')) {
      sendJson(res, status, { error: status === 500 ? 'server-error' : error.message });
    } else {
      sendText(res, status, status === 500 ? 'Something went wrong' : error.message);
    }
  }

  async _servePairPage(res, failed) {
    if (!this._pairPage) {
      this._pairPage = await fsp.readFile(path.join(this.publicDir, 'pair.html'), 'utf8').catch(() => null);
    }
    if (!this._pairPage) {
      sendText(res, 500, 'Pairing page is missing');
      return;
    }
    // The panel lives on its own ephemeral loopback port, so the instructions
    // on the phone mirror the URL the laptop actually printed.
    const html = this._pairPage
      .replaceAll('<!--PANEL_URL-->', `127.0.0.1:${this.adminPort}/desktop`)
      .replace(
        '<!--PAIR_ERROR-->',
        failed ? '<p class="pair-error">That code did not match. Check the QR on your laptop.</p>' : '',
      );
    res.writeHead(200, {
      ...htmlSecurityHeaders(),
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'no-store',
    });
    res.end(html);
  }

  /* ------------------------------------------------------------------ */
  /* Library + media                                                     */
  /* ------------------------------------------------------------------ */

  _sendLibrary(res, deviceId) {
    const positions = this.progress.forDevice(deviceId);
    const folderCounts = new Map();
    const items = this.library.items.map((item) => {
      folderCounts.set(item.folderId, (folderCounts.get(item.folderId) ?? 0) + 1);
      const progress = positions[item.id] ?? null;
      return {
        ...this.library.publicItem(item),
        progress: progress
          ? { pos: progress.pos, dur: progress.dur, updated: progress.updated, finished: Boolean(progress.finished) }
          : null,
      };
    });

    const folders = this.configStore.value.folders.map((folder) => ({
      id: folder.id,
      label: folder.label,
      count: folderCounts.get(folder.id) ?? 0,
    }));

    sendJson(res, 200, {
      app: 'trainu',
      version: VERSION,
      name: this.configStore.value.name,
      deviceId,
      revision: this.library.revision,
      scanning: this.library.scanning,
      scanStartedAt: this.library.scanStartedAt || null,
      scannedAt: this.library.scannedAt || null,
      count: items.length,
      totalBytes: items.reduce((sum, item) => sum + item.size, 0),
      folders,
      collections: [...new Set(items.map((item) => item.collection))].sort((a, b) => a.localeCompare(b)),
      items,
      transcoding: this.configStore.value.transcoding && this.mediaTools.available,
      ffmpeg: this.mediaTools.available,
      errors: this.library.errors.slice(0, 4),
    });
  }

  async _sendMedia(req, res, id) {
    const item = this.library.get(id);
    if (!item) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    let stat;
    try {
      stat = await fsp.stat(item.filePath);
    } catch {
      sendJson(res, 404, { error: 'file-missing', message: 'That file moved or was deleted. Rescan the library.' });
      return;
    }
    await streamMedia(req, res, { filePath: item.filePath, stat, fileName: item.file });
  }

  async _convert(req, res, url, id) {
    const item = this.library.get(id);
    if (!item) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    if (!this.configStore.value.transcoding || !this.mediaTools.available) {
      sendJson(res, 501, {
        error: 'ffmpeg-missing',
        message: 'Install ffmpeg on the laptop to play this format.',
      });
      return;
    }
    if (this.mediaTools.activeConversions >= 2) {
      sendJson(res, 429, { error: 'busy', message: 'Two videos are already converting. Try again shortly.' });
      return;
    }

    const rawStart = Number(url.searchParams.get('start'));
    const start = Number.isFinite(rawStart) ? Math.max(0, Math.min(rawStart, item.duration ?? rawStart)) : 0;
    const copy = url.searchParams.get('copy') === '0' ? false : this.mediaTools.canCopy(item);

    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'none',
      'X-Trainu-Mode': copy ? 'remux' : 'transcode',
      'Content-Disposition': contentDisposition(`${item.title}.mp4`),
    });
    res.flushHeaders?.();
    this.log.info('Live conversion started', { file: item.file, start, copy });
    await this.mediaTools.convertToResponse(item, res, { start, copy }).catch((error) => {
      this.log.warn('Conversion ended early', { file: item.file, error: error.message });
    });
  }

  async _sendThumbnail(res, id) {
    const item = this.library.get(id);
    if (!item) {
      sendText(res, 404, 'Not found');
      return;
    }
    const filePath = await this.mediaTools.thumbnail(item);
    if (!filePath) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Length': '0' });
      res.end();
      return;
    }
    this.library.setThumbReady(id);
    if (res.destroyed) return;
    try {
      const stat = await fsp.stat(filePath);
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'image/jpeg',
        'Content-Length': String(stat.size),
        'Cache-Control': 'private, max-age=86400',
      });
      fs.createReadStream(filePath).pipe(res);
    } catch {
      sendText(res, 404, 'Not found');
    }
  }

  async _sendSubtitle(req, res, id, index) {
    const item = this.library.get(id);
    const subtitles = this.library.subtitlesFor(id);
    const subtitle = subtitles[index];
    if (!item || !subtitle) {
      sendText(res, 404, 'Not found');
      return;
    }
    try {
      let text = await fsp.readFile(subtitle.path, 'utf8');
      text = text.replace(/^\uFEFF/, '');
      if (subtitle.kind === 'srt') text = srtToVtt(text);
      else if (subtitle.kind !== 'vtt') {
        sendText(res, 415, 'Subtitle format not supported in a browser');
        return;
      }
      const body = Buffer.from(text, 'utf8');
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/vtt; charset=utf-8',
        'Content-Length': String(body.length),
        'Cache-Control': 'private, max-age=3600',
      });
      if (req.method === 'HEAD') res.end();
      else res.end(body);
    } catch {
      sendText(res, 404, 'Not found');
    }
  }

  async _saveProgress(req, res, deviceId) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method-not-allowed' });
      return;
    }
    const body = await readJson(req);
    const item = this.library.get(String(body.id ?? ''));
    if (!item) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    const entry = this.progress.set(deviceId, item.id, body.position, body.duration);
    if (Number.isFinite(Number(body.duration)) && Number(body.duration) > 1 && !item.duration) {
      item.duration = Number(body.duration);
      this.mediaTools.recordDuration(item.id, Number(body.duration), item);
      this.library.revision += 1;
    }
    sendJson(res, 200, { ok: true, progress: entry });
  }

  async _clearProgress(req, res, deviceId) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method-not-allowed' });
      return;
    }
    const body = await readJson(req);
    this.progress.clear(deviceId, body.all ? null : String(body.id ?? ''));
    sendJson(res, 200, { ok: true });
  }

  /* ------------------------------------------------------------------ */
  /* Admin (separate loopback-only listener)                             */
  /* ------------------------------------------------------------------ */

  async _handleAdmin(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    req.on('error', () => {});
    res.on('error', () => {});

    try {
      if (!isLoopback(req)) {
        sendJson(res, 403, { error: 'admin-local-only' });
        return;
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, SECURITY_HEADERS);
        res.end();
        return;
      }
      if (!['GET', 'HEAD', 'POST', 'DELETE'].includes(req.method)) {
        sendJson(res, 405, { error: 'method-not-allowed' });
        return;
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = url.pathname;

      if (pathname === '/' || pathname === '/desktop') {
        const served = await serveStatic(req, res, this.publicDir, '/desktop.html');
        if (!served) sendText(res, 404, 'Control panel is missing');
        return;
      }

      if (pathname === '/phone') {
        redirect(res, `http://127.0.0.1:${this.port}/`);
        return;
      }

      if (pathname.startsWith('/api/admin/')) {
        await this._handleAdminApi(req, res, url);
        return;
      }

      if (pathname === '/favicon.svg' || pathname === '/favicon.ico' || pathname === '/iso-local-link.svg'
        || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
        const served = await serveStatic(req, res, this.publicDir, pathname);
        if (!served) sendText(res, 404, 'Not found');
        return;
      }

      sendJson(res, 404, { error: 'not-found' });
    } catch (error) {
      const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      if (status >= 500) this.log.error('Control panel request failed', { path: req.url, error: error.message });
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if ((req.url ?? '').startsWith('/api/')) sendJson(res, status, { error: status === 500 ? 'server-error' : error.message });
      else sendText(res, status, status === 500 ? 'Something went wrong' : error.message);
    }
  }

  async _adbStatus(force = false) {
    if (!force && this._adbCache && Date.now() - this._adbCache.at < 10_000) {
      return this._adbCache.value;
    }
    const adbPath = findAdb();
    const [probe, reverse] = adbPath
      ? await Promise.all([adbDevicesDetailed(adbPath), adbReverseList(adbPath)])
      : [{ devices: [], error: null }, []];
    const value = {
      available: Boolean(adbPath),
      path: adbPath,
      devices: probe.devices,
      error: probe.error,
      reverse,
    };
    this._adbCache = { at: Date.now(), value };
    return value;
  }

  async _handleAdminApi(req, res, url) {
    const pathname = url.pathname;

    if (pathname === '/api/admin/status') {
      const adb = await this._adbStatus();
      const { urls, local } = this.urls;
      const counts = new Map();
      for (const item of this.library.items) {
        counts.set(item.folderId, (counts.get(item.folderId) ?? 0) + 1);
      }
      sendJson(res, 200, {
        app: 'trainu',
        version: VERSION,
        name: this.configStore.value.name,
        port: this.port,
        panelUrl: this.adminUrl,
        phoneUrl: `http://127.0.0.1:${this.port}/`,
        startedAt: this.startedAt,
        dataDir: this.configStore.dataDir,
        platform: process.platform,
        node: process.version,
        urls,
        local,
        token: this.configStore.value.token,
        firewall: firewallCommand(this.port),
        folders: this.configStore.value.folders.map((folder) => ({
          id: folder.id,
          label: folder.label,
          path: folder.path,
          exists: fs.existsSync(folder.path),
          count: counts.get(folder.id) ?? 0,
        })),
        library: {
          scanning: this.library.scanning,
          scanStartedAt: this.library.scanStartedAt || null,
          scannedAt: this.library.scannedAt || null,
          count: this.library.items.length,
          totalBytes: this.library.items.reduce((sum, item) => sum + item.size, 0),
          errors: this.library.errors.slice(0, 5),
        },
        media: this.mediaTools.status(),
        adb,
        usb: urls.filter((entry) => entry.kind === 'usb'),
        log: this.log.recent(50),
        transcoding: this.configStore.value.transcoding,
        autoScanMinutes: this.configStore.value.autoScanMinutes,
      });
      return;
    }

    if (pathname === '/api/admin/scan' && req.method === 'POST') {
      if (this.library.scanning) {
        sendJson(res, 200, { ok: true, scanning: true });
        return;
      }
      this.library.scan({ reason: 'manual' }).catch((error) => this.log.error('Scan failed', { error: error.message }));
      sendJson(res, 200, { ok: true, scanning: true });
      return;
    }

    if (pathname === '/api/admin/folders' && req.method === 'POST') {
      const body = await readJson(req);
      const folder = await this.configStore.addFolder(body.path, body.label);
      this.library.scan({ reason: 'folder-added' }).catch(() => {});
      sendJson(res, 200, { ok: true, folder });
      return;
    }

    const folderMatch = /^\/api\/admin\/folders\/([a-f0-9]+)$/.exec(pathname);
    if (folderMatch && req.method === 'DELETE') {
      const removed = await this.configStore.removeFolder(folderMatch[1]);
      if (removed) this.library.scan({ reason: 'folder-removed' }).catch(() => {});
      sendJson(res, removed ? 200 : 404, { ok: removed });
      return;
    }

    if (pathname === '/api/admin/config' && req.method === 'POST') {
      const body = await readJson(req);
      const patch = {};
      if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 60);
      if (typeof body.ffmpegPath === 'string') patch.ffmpegPath = body.ffmpegPath.trim();
      if (typeof body.transcoding === 'boolean') patch.transcoding = body.transcoding;
      if (Number.isInteger(body.autoScanMinutes) && body.autoScanMinutes >= 0 && body.autoScanMinutes <= 1440) {
        patch.autoScanMinutes = body.autoScanMinutes;
      }
      await this.configStore.update(patch);
      if (patch.ffmpegPath !== undefined) this.mediaTools.detect();
      sendJson(res, 200, { ok: true, media: this.mediaTools.status() });
      return;
    }

    if (pathname === '/api/admin/usb/reverse' && req.method === 'POST') {
      const body = await readJson(req);
      const waitMs = Number.isInteger(body.waitMs)
        ? Math.max(0, Math.min(body.waitMs, 45_000))
        : undefined;
      const result = await enableAdbReverse(this.port, waitMs === undefined ? {} : { waitMs });
      this._adbCache = null;
      this.log.info('USB link request', {
        ok: result.ok,
        reason: result.reason ?? null,
        waitedMs: result.waitedMs ?? 0,
        restarted: result.restarted ?? false,
      });
      // A failed connection attempt is still a successful admin command: the
      // panel needs the structured reason and device state to guide the user.
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/admin/reveal' && req.method === 'POST') {
      const body = await readJson(req);
      const folder = this.configStore.value.folders.find((entry) => entry.id === body.folderId);
      if (!folder) {
        sendJson(res, 404, { error: 'not-found' });
        return;
      }
      const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(command, [folder.path], { detached: true, stdio: 'ignore' }).unref();
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: 'not-found' });
  }
}
