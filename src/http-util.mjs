import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { staticMimeFor } from './paths.mjs';

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

const HTML_CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function htmlSecurityHeaders() {
  return { ...SECURITY_HEADERS, 'Content-Security-Policy': HTML_CSP };
}

export function sendJson(res, status, payload, headers = {}) {
  const raw = Buffer.from(JSON.stringify(payload));
  let body = raw;
  const extra = {};
  const acceptsGzip = /\bgzip\b/.test(res.req?.headers['accept-encoding'] ?? '');
  if (acceptsGzip && raw.length > 1024) {
    body = zlib.gzipSync(raw, { level: 6 });
    extra['Content-Encoding'] = 'gzip';
    extra.Vary = 'Accept-Encoding';
  }
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    ...extra,
    ...headers,
  });
  if (res.req?.method === 'HEAD') res.end();
  else res.end(body);
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', headers = {}) {
  const body = String(text);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function redirect(res, location, headers = {}) {
  res.writeHead(302, {
    ...SECURITY_HEADERS,
    Location: location,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end();
}

export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function cookieHeader(name, value, { maxAge = 365 * 24 * 3600, httpOnly = true, sameSite = 'Lax', path: cookiePath = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${cookiePath}`, `Max-Age=${maxAge}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

export function clientAddress(req) {
  const raw = req.socket?.remoteAddress ?? '';
  if (raw === '::1') return '127.0.0.1';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}

export function isLoopback(req) {
  const address = clientAddress(req);
  return address === '127.0.0.1' || address === '::1' || address.startsWith('127.');
}

/** Read and parse a size-limited JSON request body. */
export async function readJson(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
}

export function etagFor(value) {
  return `"${crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 20)}"`;
}

/**
 * Serve a file from publicDir with ETag, HEAD and 304 support.
 * Returns false when the path does not exist (caller decides the 404).
 */
export async function serveStatic(req, res, publicDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendText(res, 400, 'Bad request');
    return true;
  }
  if (decoded.includes('\0')) {
    sendText(res, 400, 'Bad request');
    return true;
  }

  const root = path.resolve(publicDir);
  const relative = decoded.replace(/^[/\\]+/, '');
  let filePath = path.resolve(root, relative);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    sendText(res, 403, 'Forbidden');
    return true;
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = await fsp.stat(filePath);
    }
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const type = staticMimeFor(filePath);
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const cache = /[\\/](icons|vendor)[\\/]/.test(filePath)
    ? 'public, max-age=604800'
    : 'no-cache';

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ...SECURITY_HEADERS, ETag: etag, 'Cache-Control': cache });
    res.end();
    return true;
  }

  res.writeHead(200, {
    ...(type === 'text/html; charset=utf-8' ? htmlSecurityHeaders() : SECURITY_HEADERS),
    'Content-Type': type,
    'Content-Length': String(stat.size),
    'Cache-Control': cache,
    'Last-Modified': new Date(stat.mtimeMs).toUTCString(),
    ETag: etag,
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  await new Promise((resolve) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) sendText(res, 500, 'Could not read file');
      else res.destroy();
      resolve();
    });
    stream.on('end', resolve);
    stream.pipe(res);
  });
  return true;
}

/** Normalise a URL pathname to a relative asset name. */
export function safeSegment(value) {
  return /^[a-zA-Z0-9._-]+$/.test(value) ? value : null;
}
