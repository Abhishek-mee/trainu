import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  cleanTitle,
  DIRECT_PLAY_EXTS,
  episodeLabel,
  mediaId,
  extOf,
  VIDEO_EXTS,
  subtitleKind,
} from './paths.mjs';

const EXCLUDED_DIRS = new Set([
  'node_modules', '$recycle.bin', 'system volume information', '__macosx',
  '.git', '.svn', '.hg', '.trainu', 'lost+found',
]);
const MAX_DEPTH = 12;
const MAX_ITEMS = 50000;

const WEB_VIDEO_CODECS = new Set(['h264', 'av1', 'vp9', 'vp8']);
const WEB_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

const LANGUAGE_NAMES = {
  en: 'English', eng: 'English', english: 'English',
  hi: 'Hindi', hin: 'Hindi', hindi: 'Hindi',
  es: 'Spanish', spa: 'Spanish', spanish: 'Spanish',
  fr: 'French', fre: 'French', fra: 'French', french: 'French',
  de: 'German', ger: 'German', deu: 'German', german: 'German',
  ar: 'Arabic', ara: 'Arabic', arabic: 'Arabic',
  ja: 'Japanese', jpn: 'Japanese', japanese: 'Japanese',
  ko: 'Korean', kor: 'Korean', korean: 'Korean',
  zh: 'Chinese', chi: 'Chinese', chinese: 'Chinese',
  ru: 'Russian', rus: 'Russian', russian: 'Russian',
  pt: 'Portuguese', por: 'Portuguese', portuguese: 'Portuguese',
  it: 'Italian', ita: 'Italian', italian: 'Italian',
  ta: 'Tamil', tam: 'Tamil', tamil: 'Tamil',
  te: 'Telugu', tel: 'Telugu', telugu: 'Telugu',
  ml: 'Malayalam', mal: 'Malayalam', malayalam: 'Malayalam',
  kn: 'Kannada', kan: 'Kannada', kannada: 'Kannada',
  bn: 'Bengali', ben: 'Bengali', bengali: 'Bengali',
  ur: 'Urdu', urd: 'Urdu', urdu: 'Urdu',
  forced: 'Forced', sdh: 'SDH', cc: 'CC',
};

export function languageLabel(suffix) {
  const key = String(suffix ?? '').toLowerCase().replace(/^[._-]+/, '').trim();
  if (!key) return 'Subtitles';
  if (LANGUAGE_NAMES[key]) return LANGUAGE_NAMES[key];
  const cleaned = key.replace(/[._-]+/g, ' ').trim();
  return cleaned ? cleaned.replace(/\b\w/g, (char) => char.toUpperCase()) : 'Subtitles';
}

function playbackInfo(ext, meta) {
  if (!DIRECT_PLAY_EXTS.has(ext)) {
    return { direct: false, reason: 'container' };
  }
  if (!meta) return { direct: true, reason: '' };
  if (meta.vcodec && !WEB_VIDEO_CODECS.has(meta.vcodec)) {
    return { direct: false, reason: 'video-codec' };
  }
  if (meta.acodec && !WEB_AUDIO_CODECS.has(meta.acodec)) {
    return { direct: false, reason: 'audio-codec' };
  }
  return { direct: true, reason: '' };
}

function subtitleCandidates(videoFileName, subtitleEntries) {
  const base = path.basename(videoFileName, path.extname(videoFileName)).toLowerCase();
  const found = [];
  for (const entry of subtitleEntries) {
    const subBase = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
    if (subBase !== base && !subBase.startsWith(`${base}.`) && !subBase.startsWith(`${base}_`)) continue;
    const kind = subtitleKind(entry.name);
    if (kind !== 'srt' && kind !== 'vtt') continue;
    const suffix = subBase === base ? '' : subBase.slice(base.length + 1);
    found.push({
      fileName: entry.name,
      kind,
      lang: suffix.split(/[._-]/)[0] || '',
      label: languageLabel(suffix),
    });
  }
  found.sort((a, b) => a.label.localeCompare(b.label));
  return found.slice(0, 12);
}

export class Library {
  /**
   * @param {{configStore: import('./config.mjs').ConfigStore, mediaTools: import('./media.mjs').MediaTools, log: import('./log.mjs').Log}} options
   */
  constructor({ configStore, mediaTools, log }) {
    this.configStore = configStore;
    this.mediaTools = mediaTools;
    this.log = log;
    this.items = [];
    this.byId = new Map();
    this.subtitleFiles = new Map();
    this.folders = [];
    this.scannedAt = 0;
    this.scanning = false;
    this.scanStartedAt = 0;
    this.scanError = null;
    this.revision = 0;
    this.scanPromise = null;
    this.errors = [];
  }

  async scan({ reason = 'startup' } = {}) {
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this._scan(reason).finally(() => { this.scanPromise = null; });
    return this.scanPromise;
  }

  async _scan(reason) {
    const startedAt = Date.now();
    this.scanning = true;
    this.scanStartedAt = startedAt;
    this.scanError = null;
    this.errors = [];
    const items = [];
    const subtitleFiles = new Map();
    const roots = this.configStore.value.folders;

    this.log.scan('Scanning library', { folders: roots.length, reason });

    for (const root of roots) {
      try {
        await this._walk(root, items, subtitleFiles);
      } catch (error) {
        this.errors.push({ folder: root.path, error: error.message });
        this.log.warn('Could not scan folder', { path: root.path, error: error.message });
      }
    }

    items.sort((a, b) => (b.mtimeMs - a.mtimeMs) || a.title.localeCompare(b.title));
    this.items = items;
    this.byId = new Map(items.map((item) => [item.id, item]));
    this.subtitleFiles = subtitleFiles;
    this.scannedAt = Date.now();
    this.scanning = false;
    this.revision += 1;

    const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
    this.log.scan('Library ready', {
      videos: items.length,
      size: `${(totalBytes / 1024 ** 3).toFixed(1)} GB`,
      ms: Date.now() - startedAt,
    });

    // Metadata is nice-to-have, so never block the library on it.
    this.mediaTools.enrich(items, (item, meta) => {
      this.applyMeta(item, meta);
      this.revision += 1;
    }).catch((error) => this.log.warn('Metadata scan stopped', { error: error.message }));

    return items;
  }

  async _walk(root, items, subtitleFiles) {
    const stack = [{ abs: root.path, rel: '', depth: 0 }];
    let mediaCount = 0;

    while (stack.length) {
      const { abs, rel, depth } = stack.pop();
      let entries;
      try {
        entries = await fsp.readdir(abs, { withFileTypes: true });
      } catch (error) {
        this.errors.push({ folder: abs, error: error.message });
        continue;
      }

      const videos = [];
      const subtitles = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
          const lower = entry.name.toLowerCase();
          if (depth < MAX_DEPTH && !EXCLUDED_DIRS.has(lower)) {
            stack.push({ abs: path.join(abs, entry.name), rel: path.join(rel, entry.name), depth: depth + 1 });
          }
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = extOf(entry.name);
        if (VIDEO_EXTS.has(ext)) videos.push(entry);
        else if (subtitleKind(entry.name)) subtitles.push(entry);
      }

      for (const entry of videos) {
        if (mediaCount >= MAX_ITEMS) {
          this.log.warn('Library item limit reached', { limit: MAX_ITEMS });
          return;
        }
        const ext = extOf(entry.name);
        const mediaPath = path.join(abs, entry.name);
        let stat;
        try {
          stat = await fsp.stat(mediaPath);
        } catch {
          continue;
        }
        mediaCount += 1;
        const relPath = path.join(rel, entry.name);
        const id = mediaId(root.id, relPath);
        const meta = this.mediaTools.metaFor({ id, size: stat.size, mtimeMs: stat.mtimeMs });
        const playback = playbackInfo(ext, meta);
        const subtitlesForFile = subtitleCandidates(entry.name, subtitles);
        const title = cleanTitle(entry.name);
        const collection = rel ? rel.split(path.sep)[0] : root.label;

        items.push({
          id,
          title,
          file: entry.name,
          ext,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          folderId: root.id,
          folderLabel: root.label,
          collection,
          dir: rel,
          episode: episodeLabel(entry.name),
          duration: meta?.duration ?? null,
          width: meta?.width ?? null,
          height: meta?.height ?? null,
          vcodec: meta?.vcodec ?? null,
          acodec: meta?.acodec ?? null,
          direct: playback.direct,
          directReason: playback.reason,
          thumb: this.mediaTools.thumbExists(id),
          subtitles: subtitlesForFile.map(({ label, lang, kind }, index) => ({ label, lang, kind, index })),
          filePath: mediaPath,
        });

        if (subtitlesForFile.length) {
          subtitleFiles.set(id, subtitlesForFile.map((sub) => ({
            ...sub,
            path: path.join(abs, sub.fileName),
          })));
        }
      }
    }
  }

  applyMeta(item, meta) {
    if (!meta) return;
    if (meta.duration) item.duration = meta.duration;
    if (meta.width) item.width = meta.width;
    if (meta.height) item.height = meta.height;
    if (meta.vcodec) item.vcodec = meta.vcodec;
    if (meta.acodec) item.acodec = meta.acodec;
    const playback = playbackInfo(item.ext, meta);
    item.direct = playback.direct;
    item.directReason = playback.reason;
  }

  get(id) {
    return this.byId.get(id) ?? null;
  }

  subtitlesFor(id) {
    return this.subtitleFiles.get(id) ?? [];
  }

  setThumbReady(id) {
    const item = this.byId.get(id);
    if (item && !item.thumb) {
      item.thumb = true;
      this.revision += 1;
    }
  }

  /** Serialisable item without filesystem paths. */
  publicItem(item) {
    return {
      id: item.id,
      title: item.title,
      file: item.file,
      ext: item.ext,
      size: item.size,
      mtime: item.mtimeMs,
      folderId: item.folderId,
      folderLabel: item.folderLabel,
      collection: item.collection,
      dir: item.dir,
      episode: item.episode,
      duration: item.duration,
      width: item.width,
      height: item.height,
      vcodec: item.vcodec,
      acodec: item.acodec,
      direct: item.direct,
      directReason: item.directReason,
      thumb: item.thumb,
      subtitles: item.subtitles,
    };
  }
}

export { EXCLUDED_DIRS, MAX_ITEMS };
