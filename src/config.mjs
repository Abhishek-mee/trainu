import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DEFAULT_PORT = 8765;
export const VERSION = '1.0.0';

export function defaultDataDir() {
  if (process.env.TRAINU_DATA) return path.resolve(process.env.TRAINU_DATA);
  return path.join(PROJECT_ROOT, '.trainu');
}

function newToken() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function isDirectory(candidate) {
  return fs.stat(candidate).then((stat) => stat.isDirectory()).catch(() => false);
}

function expandHome(input) {
  const value = String(input ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

async function defaultFolders() {
  const candidates = [
    ['Videos', path.join(os.homedir(), 'Videos')],
    ['Movies', path.join(os.homedir(), 'Movies')],
  ];
  const folders = [];
  for (const [label, folderPath] of candidates) {
    if (await isDirectory(folderPath)) {
      folders.push({ id: crypto.randomBytes(4).toString('hex'), label, path: folderPath, addedAt: Date.now() });
    }
  }
  return folders;
}

function baseConfig({ folders }) {
  return {
    version: 1,
    name: 'Trainu',
    port: DEFAULT_PORT,
    host: '0.0.0.0',
    token: newToken(),
    folders,
    transcoding: true,
    ffmpegPath: '',
    autoScanMinutes: 10,
    createdAt: Date.now(),
  };
}

export class ConfigStore {
  /**
   * @param {{dataDir?: string, log?: import('./log.mjs').Log, env?: NodeJS.ProcessEnv}} options
   */
  constructor({ dataDir = defaultDataDir(), log = null, env = process.env } = {}) {
    this.dataDir = path.resolve(dataDir);
    this.configPath = path.join(this.dataDir, 'config.json');
    this.log = log;
    this.env = env;
    this.config = null;
    this._writing = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    let raw = null;
    try {
      raw = await fs.readFile(this.configPath, 'utf8');
      raw = raw.replace(/^\uFEFF/, '');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    if (!raw) {
      this.config = baseConfig({ folders: await defaultFolders() });
      await this.save();
      this.log?.info('Created config', { path: this.configPath });
      return this.config;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const backup = `${this.configPath}.corrupt-${Date.now()}`;
      await fs.rename(this.configPath, backup).catch(() => {});
      this.log?.warn('Config was invalid; starting fresh', { backup });
      this.config = baseConfig({ folders: await defaultFolders() });
      await this.save();
      return this.config;
    }

    this.config = {
      ...baseConfig({ folders: [] }),
      ...parsed,
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
    };
    if (!this.config.token) this.config.token = newToken();
    if (!Number.isInteger(this.config.port) || this.config.port < 0 || this.config.port > 65535) {
      this.config.port = DEFAULT_PORT;
    }

    // Drop folders that no longer exist, but keep the rest untouched.
    const alive = [];
    for (const folder of this.config.folders) {
      if (folder?.path && await isDirectory(folder.path)) {
        alive.push({
          id: folder.id || crypto.randomBytes(4).toString('hex'),
          label: folder.label || path.basename(folder.path) || folder.path,
          path: path.resolve(folder.path),
          addedAt: folder.addedAt || Date.now(),
        });
      } else {
        this.log?.warn('Skipping missing library folder', { path: folder?.path ?? '(unknown)' });
      }
    }
    if (alive.length !== this.config.folders.length) {
      this.config.folders = alive;
      await this.save();
    }

    return this.config;
  }

  get value() {
    if (!this.config) throw new Error('ConfigStore.init() has not run');
    return this.config;
  }

  async save() {
    const write = async () => {
      const tmp = `${this.configPath}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8');
      await fs.rename(tmp, this.configPath);
    };
    this._writing = this._writing.then(write, write);
    await this._writing;
  }

  async addFolder(input, label) {
    let folderPath = expandHome(input);
    if (!folderPath) throw Object.assign(new Error('Enter a folder path'), { statusCode: 400 });
    folderPath = path.resolve(folderPath);
    if (!await isDirectory(folderPath)) {
      throw Object.assign(new Error(`Not a folder: ${folderPath}`), { statusCode: 400 });
    }
    const canonical = folderPath.toLowerCase();
    const existing = this.config.folders.find((folder) => folder.path.toLowerCase() === canonical);
    if (existing) return existing;

    const folder = {
      id: crypto.randomBytes(4).toString('hex'),
      label: String(label || '').trim() || path.basename(folderPath) || folderPath,
      path: folderPath,
      addedAt: Date.now(),
    };
    this.config.folders.push(folder);
    await this.save();
    this.log?.info('Added library folder', { path: folder.path });
    return folder;
  }

  async removeFolder(id) {
    const before = this.config.folders.length;
    this.config.folders = this.config.folders.filter((folder) => folder.id !== id);
    if (this.config.folders.length === before) return false;
    await this.save();
    this.log?.info('Removed library folder', { id });
    return true;
  }

  async update(patch) {
    const allowed = ['name', 'transcoding', 'ffmpegPath', 'autoScanMinutes', 'host', 'port'];
    for (const key of allowed) {
      if (patch[key] !== undefined) this.config[key] = patch[key];
    }
    await this.save();
    return this.config;
  }

  /** Config safe to expose to a paired phone (never includes the server token). */
  publicInfo() {
    return {
      name: this.config.name,
      transcoding: this.config.transcoding,
    };
  }
}
