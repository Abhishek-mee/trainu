import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Per-device playback positions. Stored in one small JSON file and written with
 * a short debounce so seeking does not hammer the disk.
 */
export class ProgressStore {
  constructor({ dataDir, log = null }) {
    this.file = path.join(dataDir, 'progress.json');
    this.log = log;
    this.data = { devices: {} };
    this._timer = null;
    this._writing = Promise.resolve();
  }

  async load() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.devices && typeof parsed.devices === 'object') {
        this.data = parsed;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') this.log?.warn('Could not read watch progress', { error: error.message });
    }
    return this;
  }

  /** @returns {Record<string, {pos: number, dur: number, updated: number}>} */
  forDevice(deviceId) {
    if (!deviceId) return {};
    return this.data.devices[deviceId] ?? {};
  }

  get(deviceId, itemId) {
    return this.forDevice(deviceId)[itemId] ?? null;
  }

  set(deviceId, itemId, position, duration) {
    if (!deviceId || !itemId) return null;
    const pos = Math.max(0, Number(position) || 0);
    const dur = Math.max(0, Number(duration) || 0);
    if (!Number.isFinite(pos) || !Number.isFinite(dur)) return null;

    const devices = this.data.devices;
    const entry = { pos: Math.round(pos * 10) / 10, dur: Math.round(dur * 10) / 10, updated: Date.now() };
    devices[deviceId] ??= {};

    if (dur > 0 && pos >= dur - Math.min(30, dur * 0.03)) {
      entry.finished = true;
    }
    if (pos < 5) {
      delete devices[deviceId][itemId];
    } else {
      devices[deviceId][itemId] = entry;
    }
    this._prune();
    this._scheduleSave();
    return entry;
  }

  clear(deviceId, itemId) {
    if (!deviceId) return;
    if (itemId) {
      delete this.data.devices[deviceId]?.[itemId];
    } else {
      this.data.devices[deviceId] = {};
    }
    this._scheduleSave();
  }

  _prune() {
    const perDevice = 500;
    const devices = this.data.devices;
    for (const [deviceId, entries] of Object.entries(devices)) {
      const keys = Object.keys(entries);
      if (keys.length <= perDevice) continue;
      keys
        .sort((a, b) => (entries[a]?.updated ?? 0) - (entries[b]?.updated ?? 0))
        .slice(0, keys.length - perDevice)
        .forEach((key) => delete entries[key]);
    }
  }

  _scheduleSave() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush().catch(() => {});
    }, 400);
    this._timer.unref?.();
  }

  async flush() {
    const write = async () => {
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(this.data)}\n`, 'utf8');
      await fs.rename(tmp, this.file);
    };
    this._writing = this._writing.then(write, write);
    await this._writing;
  }

  async close() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    await this.flush();
  }
}
