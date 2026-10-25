const LEVEL_STYLES = {
  info: '',
  scan: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

export class Log {
  /** @param {{max?: number, silent?: boolean}} options */
  constructor({ max = 300, silent = false } = {}) {
    this.entries = [];
    this.max = max;
    this.silent = silent;
    this.listeners = new Set();
  }

  /**
   * @param {'info'|'scan'|'warn'|'error'} level
   * @param {string} message
   * @param {Record<string, unknown>} [fields]
   */
  add(level, message, fields) {
    const entry = {
      at: new Date().toISOString(),
      level,
      message,
      ...(fields ? { fields } : {}),
    };
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    for (const listener of this.listeners) listener(entry);

    if (!this.silent) {
      const style = LEVEL_STYLES[level] ?? '';
      const time = entry.at.slice(11, 19);
      const suffix = fields ? ` ${DIM}${JSON.stringify(fields)}${RESET}` : '';
      const stream = level === 'error' ? process.stderr : process.stdout;
      stream.write(`${DIM}${time}${RESET} ${style}${level.padEnd(5)}${RESET} ${message}${suffix}\n`);
    }
    return entry;
  }

  info(message, fields) { return this.add('info', message, fields); }
  scan(message, fields) { return this.add('scan', message, fields); }
  warn(message, fields) { return this.add('warn', message, fields); }
  error(message, fields) { return this.add('error', message, fields); }

  /** Most recent entries, oldest first. */
  recent(limit = 60) {
    return this.entries.slice(-limit);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
