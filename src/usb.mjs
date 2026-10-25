import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VIRTUAL_INTERFACE = /(vEthernet|WSL|Bluetooth|Loopback|Teredo|Tailscale|ZeroTier|VMware|VirtualBox|Hyper-V|Docker|veth|br-)/i;
const USB_INTERFACE = /(usb|rndis|remote ndis|tether)/i;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROMPT_WAIT_MS = 20_000;
const PENDING_STATES = new Set(['unauthorized', 'offline', 'no-permissions']);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ready = (device) => device.state === 'device';
const pending = (device) => PENDING_STATES.has(device.state);

function exists(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function cleanOutput(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\* daemon/.test(line))
    .join(' ')
    .trim();
}

/** Find adb in the project, PATH, an env override or the usual SDK locations. */
export function findAdb() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [];

  const configured = process.env.TRAINU_ADB || process.env.ADB_PATH;
  if (configured) {
    candidates.push(configured, path.join(configured, exe));
  }

  // Dropping platform-tools next to Trainu is the easiest install for people
  // who do not use Android Studio. The folder is ignored by git.
  for (const root of [
    path.join(PROJECT_ROOT, 'tools', 'platform-tools'),
    path.join(PROJECT_ROOT, 'platform-tools'),
    path.join(PROJECT_ROOT, 'tools', 'adb'),
  ]) {
    candidates.push(path.join(root, exe));
  }

  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
      : null,
    process.platform === 'win32' && process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Android', 'Sdk')
      : null,
    process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Android', 'sdk') : null,
    path.join(os.homedir(), 'Android', 'Sdk'),
  ].filter(Boolean);
  for (const root of sdkRoots) candidates.push(path.join(root, 'platform-tools', exe));
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\adb\\adb.exe',
      'C:\\platform-tools\\adb.exe',
      'C:\\Android\\platform-tools\\adb.exe',
    );
  }

  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) candidates.push(path.join(dir.replace(/^"|"$/g, ''), exe));

  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate;
  }
  return null;
}

function run(command, args, { timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, stdout: '', stderr: error.message });
      return;
    }
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
      if (!child.killed) child.kill('SIGKILL');
      finish({ ok: false, stdout, stderr: 'adb timed out' });
    }, timeout);
    timer.unref?.();
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish({ ok: false, stdout, stderr: error.message }));
    child.on('close', (code) => finish({ ok: code === 0, code, stdout, stderr }));
  });
}

/** Parse `adb devices -l` without losing unauthorized or offline phones. */
export function parseAdbDevices(output) {
  const devices = [];
  for (const raw of String(output ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^list of devices/i.test(line) || line.startsWith('*')) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [serial] = parts;
    if (!/^[A-Za-z0-9._:+-]+$/.test(serial)) continue;

    let state = parts[1];
    let tailStart = 2;
    if (state === 'no' && parts[2] === 'permissions') {
      state = 'no-permissions';
      tailStart = 3;
    }
    const tail = parts.slice(tailStart).join(' ');
    devices.push({
      serial,
      state,
      model: /(?:^|\s)model:(\S+)/.exec(tail)?.[1]?.replaceAll('_', ' ') ?? '',
      product: /(?:^|\s)product:(\S+)/.exec(tail)?.[1] ?? '',
      transportId: /(?:^|\s)transport_id:(\S+)/.exec(tail)?.[1] ?? '',
    });
  }
  return devices;
}

export async function adbDevicesDetailed(adbPath, runner = run) {
  if (!adbPath) return { devices: [], error: null };
  const result = await runner(adbPath, ['devices', '-l']);
  if (!result.ok) {
    return {
      devices: [],
      error: cleanOutput(result.stderr || result.stdout) || 'adb could not list devices.',
    };
  }
  return { devices: parseAdbDevices(result.stdout), error: null };
}

export async function adbDevices(adbPath, runner = run) {
  return (await adbDevicesDetailed(adbPath, runner)).devices;
}

export async function adbReverseList(adbPath) {
  if (!adbPath) return [];
  const result = await run(adbPath, ['reverse', '--list']);
  if (!result.ok) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function describeProblem(devices, error) {
  const unauthorized = devices.find((device) => device.state === 'unauthorized');
  if (unauthorized) {
    return {
      reason: 'unauthorized',
      message: 'Phone found, but the USB debugging prompt has not been accepted. Unlock the phone and tap Allow. If you do not see the dialog, use "Phone prompt not showing?" below.',
    };
  }
  const offline = devices.find((device) => device.state === 'offline');
  if (offline) {
    return {
      reason: 'offline',
      message: 'Phone is connected but adb reports it offline. Unplug and replug the cable, then try Connect phone again.',
    };
  }
  const denied = devices.find((device) => device.state === 'no-permissions');
  if (denied) {
    return {
      reason: 'no-permissions',
      message: 'The laptop cannot access the phone USB interface. Replug the cable and accept the USB debugging prompt.',
    };
  }
  if (error) {
    return {
      reason: 'adb-error',
      message: `adb is installed but could not list devices: ${error}`,
    };
  }
  return {
    reason: 'no-device',
    message: 'No phone detected by adb. Connect the cable, choose File transfer in the phone notification, and turn on USB debugging.',
  };
}

/**
 * Set up `adb reverse tcp:PORT tcp:PORT` on every connected phone, so the phone
 * can open localhost:PORT and reach this laptop.
 *
 * When a phone is visible but unauthorized, restarting the adb server makes
 * Android show the RSA prompt again. The request waits briefly for the user to
 * tap Allow, so a single "Connect phone" click is enough.
 */
export async function enableAdbReverse(port, options = {}) {
  const {
    waitMs = PROMPT_WAIT_MS,
    finder = findAdb,
    runner = run,
  } = options;
  const adbPath = finder();
  if (!adbPath) {
    return {
      ok: false,
      reason: 'no-adb',
      message: 'adb was not found. Put Android platform-tools in the Trainu folder under tools\\platform-tools, or set ADB_PATH, then try again.',
      path: null,
      devices: [],
    };
  }

  const started = await runner(adbPath, ['start-server'], { timeout: 15_000 });
  if (!started.ok) {
    return {
      ok: false,
      reason: 'adb-error',
      message: cleanOutput(started.stderr || started.stdout) || 'adb could not start. Check the platform-tools folder and try again.',
      path: adbPath,
      devices: [],
    };
  }

  let probe = await adbDevicesDetailed(adbPath, runner);
  let devices = probe.devices;
  let restarted = false;
  let waitedMs = 0;

  // A phone that was just plugged in can take a moment to enumerate.
  if (!devices.length && waitMs > 0) {
    const deadline = Date.now() + Math.min(waitMs, 2500);
    while (!devices.length && Date.now() < deadline) {
      await delay(350);
      waitedMs += 350;
      probe = await adbDevicesDetailed(adbPath, runner);
      devices = probe.devices;
    }
  }

  if (!devices.some(ready) && devices.some(pending) && waitMs > 0) {
    // Kill and restart the server so Android treats this as a fresh USB
    // debugging authorization and shows the fingerprint prompt again.
    await runner(adbPath, ['kill-server'], { timeout: 8000 });
    await runner(adbPath, ['start-server'], { timeout: 15_000 });
    restarted = true;

    let lastSeen = devices;
    const deadline = Date.now() + Math.min(waitMs, 30_000);
    while (Date.now() < deadline) {
      await delay(700);
      waitedMs += 700;
      probe = await adbDevicesDetailed(adbPath, runner);
      if (probe.devices.length) {
        devices = probe.devices;
        lastSeen = probe.devices;
      }
      if (devices.some(ready)) break;
    }
    // While adb restarts the phone briefly disappears from the list. Keep the
    // last known state so the message still says "unauthorized", not "no phone".
    if (!devices.length) devices = lastSeen;
  }

  const usable = devices.filter(ready);
  if (!usable.length) {
    return {
      ok: false,
      ...describeProblem(devices, probe.error),
      path: adbPath,
      devices,
      restarted,
      waitedMs,
    };
  }

  const results = [];
  for (const device of usable) {
    const result = await runner(
      adbPath,
      ['-s', device.serial, 'reverse', `tcp:${port}`, `tcp:${port}`],
      { timeout: 10_000 },
    );
    results.push({
      serial: device.serial,
      model: device.model,
      ok: result.ok,
      output: cleanOutput(`${result.stdout}${result.stderr}`),
    });
  }

  const ok = results.some((result) => result.ok);
  return {
    ok,
    reason: ok ? null : 'command-failed',
    message: ok
      ? `USB link ready. On the phone open http://localhost:${port}`
      : results.map((result) => result.output).filter(Boolean).join(' ') || 'adb reverse failed.',
    path: adbPath,
    devices,
    results,
    restarted,
    waitedMs,
  };
}

/**
 * All addresses the phone could use, best first.
 * @param {{port: number, token?: string}} options
 */
export function networkUrls({ port, token = '' }) {
  const interfaces = os.networkInterfaces();
  const found = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (address.address.startsWith('169.254.')) continue;
      if (VIRTUAL_INTERFACE.test(name)) continue;

      let kind = 'lan';
      let score = 10;
      if (USB_INTERFACE.test(name) || address.address.startsWith('192.168.42.') || address.address.startsWith('172.20.10.')) {
        kind = 'usb';
        score = 100;
      } else if (/wi-?fi|wlan/i.test(name)) {
        kind = 'wifi';
        score = 30;
      } else if (/ethernet|eth/i.test(name)) {
        kind = 'lan';
        score = 20;
      }
      if (address.address.startsWith('192.168.42.')) score += 20;
      const base = `http://${address.address}:${port}`;
      found.push({
        address: address.address,
        interface: name,
        kind,
        score,
        label: kind === 'usb' ? 'USB link' : kind === 'wifi' ? 'Wi-Fi' : name,
        url: base,
        pairUrl: token ? `${base}/pair?t=${token}` : base,
      });
    }
  }

  found.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  const local = {
    address: '127.0.0.1',
    interface: 'Loopback',
    kind: 'local',
    score: 0,
    label: 'This laptop',
    url: `http://127.0.0.1:${port}`,
    pairUrl: token ? `http://127.0.0.1:${port}/pair?t=${token}` : `http://127.0.0.1:${port}`,
  };
  return { urls: found, local };
}

/** Copy-paste firewall rule for Windows, shown when connections time out. */
export function firewallCommand(port) {
  if (process.platform !== 'win32') return '';
  return `netsh advfirewall firewall add rule name="Trainu ${port}" dir=in action=allow protocol=TCP localport=${port}`;
}
