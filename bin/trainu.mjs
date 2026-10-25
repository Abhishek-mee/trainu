#!/usr/bin/env node
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigStore, VERSION, defaultDataDir } from '../src/config.mjs';
import { Log } from '../src/log.mjs';
import { Library } from '../src/library.mjs';
import { MediaTools } from '../src/media.mjs';
import { ProgressStore } from '../src/progress.mjs';
import { TrainuServer } from '../src/server.mjs';
import { networkUrls } from '../src/usb.mjs';

const HELP = `
Trainu ${VERSION} — watch the videos on your laptop from your phone.

Usage:
  trainu [options]

Options:
  --port <number>   Port to listen on (default 8765, 0 picks a free port)
  --host <address>  Interface to bind (default 0.0.0.0)
  --data <folder>   Where config, cache and watch progress live
  --no-open         Do not open the laptop control panel
  --help            Show this help
  --version         Show the version
`;

const TEAL = '\x1b[38;5;44m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function banner() {
  process.stdout.write(`\n  ${TEAL}${BOLD}TRAINU${RESET} ${DIM}· your laptop, on your phone${RESET}\n\n`);
}

function openBrowser(url) {
  try {
    const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch {
    // Opening a browser is best-effort.
  }
}

let options;
try {
  ({ values: options } = parseArgs({
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      data: { type: 'string' },
      open: { type: 'boolean', default: true },
      'no-open': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
    },
    strict: true,
  }));
} catch (error) {
  process.stderr.write(`${error.message}\n\n${HELP}`);
  process.exit(1);
}

if (options.help) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (options.version) {
  process.stdout.write(`trainu ${VERSION}\n`);
  process.exit(0);
}

const log = new Log();
const dataDir = options.data ? path.resolve(options.data) : defaultDataDir();

if (options.port !== undefined) {
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    log.error('Invalid --port value', { port: options.port });
    process.exit(1);
  }
}
if (options.host) {
  process.env.TRAINU_HOST = options.host;
}

banner();
log.info('Starting Trainu', { version: VERSION, node: process.version, platform: `${os.platform()} ${os.arch()}` });

const configStore = new ConfigStore({ dataDir, log });
try {
  await configStore.init();
} catch (error) {
  log.error('Could not load configuration', { error: error.message, dataDir });
  process.exit(1);
}

if (options.port !== undefined) configStore.value.port = Number(options.port);
if (options.host) configStore.value.host = options.host;

const mediaTools = await new MediaTools({ dataDir, configStore, log }).init();
const progress = await new ProgressStore({ dataDir, log }).load();
const library = new Library({ configStore, mediaTools, log });
const server = new TrainuServer({ configStore, library, mediaTools, progress, log });

let port;
try {
  port = await server.listen();
} catch (error) {
  log.error('Could not start the server', { error: error.message });
  await progress.close();
  process.exit(1);
}

const { urls } = networkUrls({ port, token: configStore.value.token });
const panelUrl = server.adminUrl;

process.stdout.write(`\n  ${BOLD}Open the control panel on this laptop${RESET}\n  ${TEAL}${panelUrl}${RESET}\n`);
process.stdout.write(`  ${DIM}Loopback only. The phone link below cannot open it.${RESET}\n\n`);
process.stdout.write(`  ${BOLD}Pair your phone${RESET} ${DIM}(or scan the QR in the panel)${RESET}\n`);
if (urls.length) {
  for (const entry of urls) {
    process.stdout.write(`  ${entry.kind === 'usb' ? 'USB   ' : 'Phone '} ${entry.pairUrl}\n`);
  }
} else {
  process.stdout.write(`  ${DIM}No network address yet. Connect USB tethering or Wi-Fi.${RESET}\n`);
}
process.stdout.write(`\n  ${DIM}Phone code:${RESET} ${BOLD}${configStore.value.token}${RESET}   ${DIM}Press Ctrl+C to stop.${RESET}\n\n`);

// Scan immediately, but do not block the UI on a huge library.
library.scan({ reason: 'startup' }).catch((error) => log.error('Initial scan failed', { error: error.message }));

if (options.open && !options['no-open']) {
  setTimeout(() => openBrowser(panelUrl), 400).unref?.();
}

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`\n${DIM}Stopping Trainu…${RESET}\n`);
  try {
    await server.close();
    log.info('Stopped', { signal });
  } catch (error) {
    log.error('Error while stopping', { error: error.message });
  }
  process.exit(0);
}

process.on('SIGINT', () => { stop('SIGINT'); });
process.on('SIGTERM', () => { stop('SIGTERM'); });
process.on('unhandledRejection', (error) => {
  log.error('Unhandled promise rejection', { error: error instanceof Error ? error.message : String(error) });
});
process.on('uncaughtException', (error) => {
  log.error('Unexpected error', { error: error.message });
});
