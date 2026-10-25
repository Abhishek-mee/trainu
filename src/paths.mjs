import crypto from 'node:crypto';
import path from 'node:path';

/** Containers we are willing to index. */
export const VIDEO_EXTS = new Set([
  '.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.wmv', '.flv',
  '.ts', '.m2ts', '.mts', '.mpg', '.mpeg', '.ogv', '.3gp', '.asf', '.vob', '.divx',
]);

/** Containers a phone browser can usually play without help. */
export const DIRECT_PLAY_EXTS = new Set(['.mp4', '.m4v', '.webm', '.mov', '.ogv']);

export const SUBTITLE_EXTS = new Map([
  ['.srt', 'srt'],
  ['.vtt', 'vtt'],
  ['.ass', 'ass'],
  ['.ssa', 'ssa'],
]);

const MIME = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.ogv', 'video/ogg'],
  ['.mkv', 'video/x-matroska'],
  ['.avi', 'video/x-msvideo'],
  ['.wmv', 'video/x-ms-wmv'],
  ['.flv', 'video/x-flv'],
  ['.ts', 'video/mp2t'],
  ['.m2ts', 'video/mp2t'],
  ['.mts', 'video/mp2t'],
  ['.mpg', 'video/mpeg'],
  ['.mpeg', 'video/mpeg'],
  ['.3gp', 'video/3gpp'],
  ['.asf', 'video/x-ms-asf'],
  ['.vob', 'video/mpeg'],
  ['.divx', 'video/x-msvideo'],
]);

const STATIC_MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.vtt', 'text/vtt; charset=utf-8'],
]);

/** MIME type for a media filename, or application/octet-stream. */
export function mimeFor(fileName) {
  return MIME.get(path.extname(fileName).toLowerCase()) ?? 'application/octet-stream';
}

/** MIME type for a static asset filename. */
export function staticMimeFor(fileName) {
  return STATIC_MIME.get(path.extname(fileName).toLowerCase()) ?? 'application/octet-stream';
}

export function extOf(fileName) {
  return path.extname(fileName).toLowerCase();
}

export function isVideoFile(fileName) {
  return VIDEO_EXTS.has(extOf(fileName));
}

export function isDirectPlayable(fileName) {
  return DIRECT_PLAY_EXTS.has(extOf(fileName));
}

export function subtitleKind(fileName) {
  return SUBTITLE_EXTS.get(extOf(fileName)) ?? null;
}

/** Stable id for a file inside a library root. */
export function mediaId(rootId, relPath) {
  const normalized = relPath.replaceAll('\\', '/').normalize('NFC');
  return crypto.createHash('sha1').update(`${rootId}\u0000${normalized}`).digest('hex').slice(0, 16);
}

export function randomId(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

const RELEASE_WORDS = new Set([
  '2160p', '1440p', '1080p', '1080i', '720p', '576p', '480p', '4k', '8k', 'uhd', 'hdr', 'hdr10',
  'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'av1', 'divx', 'xvid', '10bit', '8bit',
  'bluray', 'blu-ray', 'brrip', 'bdrip', 'bdremux', 'remux', 'webrip', 'web-dl', 'webdl', 'web',
  'hdrip', 'dvdrip', 'dvdscr', 'hdtv', 'hdcam', 'camrip', 'hdts', 'ts', 'tc',
  'aac', 'ac3', 'eac3', 'ddp', 'dd', 'dts', 'truehd', 'atmos', 'flac', 'mp3', 'opus',
  'proper', 'repack', 'extended', 'uncut', 'unrated', 'esub', 'esubs', 'subbed', 'dubbed',
  'multi', 'dual', 'org', 'hdr', 'sdr', 'hq', 'hd',
]);

/**
 * Turn a filename into something readable. Deliberately conservative: it removes
 * scene-release noise but never rewrites words inside a title.
 */
export function cleanTitle(fileName) {
  const base = String(fileName).replace(/\.[^.\\/]+$/, '');
  let name = base.normalize('NFC');

  name = name.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ');
  // Drop a trailing scene-group suffix, e.g. "-HDHub4u.Tv" or "-RARBG".
  name = name.replace(/-([A-Za-z0-9](?:[A-Za-z0-9._]*[A-Za-z0-9])?)$/u, (match, group) => {
    const groupLike = group.includes('.') || /[A-Z]{3,}/.test(group) || /\d/.test(group);
    return groupLike && group.length >= 4 ? ' ' : match;
  });
  // Audio layout tags such as 5.1 / 7.1 / 2.0, before dots become spaces.
  name = name.replace(/\b(?:[257]\.1|2\.0)\b/g, ' ');
  name = name.replace(/[_.]+/g, ' ');
  name = name.replace(/([A-Za-z0-9])\.(?=[A-Za-z0-9])/g, '$1 ');

  const kept = [];
  for (const raw of name.split(/\s+/)) {
    if (!raw) continue;
    const key = raw
      .toLowerCase()
      .replace(/^[([{]+/, '')
      .replace(/[)\]}.,;:!?]+$/, '');
    if (RELEASE_WORDS.has(key)) continue;
    kept.push(raw.replace(/^[-–]+|[-–]+$/g, ''));
  }

  name = kept.join(' ').replace(/\s+/g, ' ').trim();
  name = name.replace(/^[\s\-–_.]+|[\s\-–_.]+$/g, '');
  if (!name) name = base;

  if (name.length > 140) {
    const cut = name.slice(0, 140);
    name = cut.slice(0, Math.max(1, cut.lastIndexOf(' '))).trim();
  }
  return name || 'Untitled';
}

/** "S02E05" when a filename looks like an episode. */
export function episodeLabel(name) {
  const sxe = /(?:^|[^a-z0-9])s(\d{1,2})[\s._-]?e(\d{1,3})(?:[^a-z0-9]|$)/i.exec(name);
  if (sxe) return `S${sxe[1].padStart(2, '0')}E${sxe[2].padStart(2, '0')}`;
  const alt = /(?:^|[^a-z0-9])(\d{1,2})x(\d{1,3})(?:[^a-z0-9]|$)/i.exec(name);
  if (alt) return `S${alt[1].padStart(2, '0')}E${alt[2].padStart(2, '0')}`;
  return '';
}

/** Human duration: 1:02:03 or 4:05. */
export function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** Safe filename for Content-Disposition. */
export function contentDisposition(fileName) {
  const ascii = String(fileName).replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
