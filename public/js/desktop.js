(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    data: null,
    method: 'adb',
    selectedUrl: '',
    qrFor: '',
    adbResult: null,
    usbBusy: false,
    lastLogSignature: '',
    lastMethodSignature: '',
    fetching: false,
    timer: null,
    ffmpegDirty: false,
    failedPolls: 0,
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
  }

  function timeAgo(timestamp) {
    if (!timestamp) return 'never';
    const seconds = Math.max(0, (Date.now() - Number(timestamp)) / 1000);
    if (seconds < 45) return 'just now';
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
    return `${Math.round(seconds / 86400)}d ago`;
  }

  function clock(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour12: false });
  }

  let toastTimer = null;
  function toast(message, { error = false } = {}) {
    const node = $('toast');
    node.textContent = message;
    node.classList.toggle('error', error);
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 3200);
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers ?? {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { cache: 'no-store', ...options, headers });
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      let payload = null;
      try {
        payload = await response.json();
        message = payload.message || payload.error || message;
      } catch { /* ignore */ }
      throw Object.assign(new Error(message), { status: response.status, payload });
    }
    return response.json();
  }

  /* ------------------------------------------------------------------ */
  /* Status polling                                                      */
  /* ------------------------------------------------------------------ */

  async function refresh({ quiet = true } = {}) {
    if (state.fetching) return;
    state.fetching = true;
    try {
      const data = await api('/api/admin/status');
      state.failedPolls = 0;
      state.data = data;
      render(data);
      $('server-pill').className = 'pill online';
      $('server-pill-text').textContent = 'Running';
    } catch (error) {
      state.failedPolls += 1;
      $('server-pill').className = 'pill offline';
      $('server-pill-text').textContent = error.status === 403 ? 'Local only' : 'No response';
      if (!quiet) toast(error.message, { error: true });
    } finally {
      state.fetching = false;
    }
  }

  function scheduleRefresh(delay = 4000) {
    clearTimeout(state.timer);
    state.timer = setTimeout(async () => {
      if (!document.hidden) await refresh();
      scheduleRefresh(4000);
    }, delay);
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function render(data) {
    $('version').textContent = data.version;
    $('intro-addr').textContent = `127.0.0.1:${data.port}`;
    $('intro-state').textContent = data.usb.length ? 'USB ready' : data.urls.length ? 'Wi-Fi ready' : 'No phone link';
    $('link-kind').textContent = data.usb.length ? 'USB' : data.urls.some((entry) => entry.kind === 'wifi') ? 'Wi-Fi' : 'LAN';
    $('server-info').textContent = `127.0.0.1:${data.port} · Node ${data.node}`;
    $('data-dir').textContent = data.dataDir ?? '';
    $('data-dir').title = data.dataDir ?? '';
    $('firewall-cmd').textContent = data.firewall || 'Not needed on this platform';

    renderStats(data);
    renderFolders(data);
    renderSystem(data);
    renderUrls(data);
    renderMethodPanel(data);
    renderLog(data);
  }

  function renderStats(data) {
    $('stat-count').textContent = data.library.count.toLocaleString();
    $('stat-size').textContent = formatBytes(data.library.totalBytes);
    $('stat-scan').textContent = data.library.scanning ? 'now' : timeAgo(data.library.scannedAt);
    $('scan-note').hidden = !data.library.scanning;
    $('scan-note-text').textContent = data.library.count
      ? `Scanning folders… ${data.library.count} videos found so far.`
      : 'Scanning folders for videos…';
    $('rescan').disabled = data.library.scanning;
    $('rescan-top').disabled = data.library.scanning;
  }

  function renderFolders(data) {
    const list = $('folder-list');
    list.replaceChildren();
    if (!data.folders.length) {
      const empty = el('li', 'folder-empty', 'No folders yet. Add the folder where your videos live below.');
      empty.style.display = 'block';
      list.appendChild(empty);
      return;
    }

    for (const folder of data.folders) {
      const item = el('li');
      const icon = el('span', 'folder-icon');
      icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2.5h6A2.5 2.5 0 0 1 20.5 10v7A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17Z"/></svg>';

      const meta = el('span', 'folder-meta');
      const name = el('b', '', folder.label);
      const path = el('span', '', folder.path);
      path.title = folder.path;
      meta.append(name, path);

      const count = el('span', 'folder-count', `${folder.count} ${folder.count === 1 ? 'video' : 'videos'}`);
      if (!folder.exists) {
        count.textContent = 'missing';
        count.style.color = 'var(--danger)';
      }

      const actions = el('span', 'folder-actions');
      const reveal = el('button', 'icon-btn');
      reveal.type = 'button';
      reveal.title = 'Open folder';
      reveal.setAttribute('aria-label', `Open ${folder.label}`);
      reveal.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>';
      reveal.addEventListener('click', () => revealFolder(folder.id));

      const remove = el('button', 'icon-btn danger');
      remove.type = 'button';
      remove.title = 'Remove folder';
      remove.setAttribute('aria-label', `Remove ${folder.label}`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7m-9 0 1 12.5h10L18 7M10 10.5v6m4-6v6"/></svg>';
      remove.addEventListener('click', () => removeFolder(folder));

      actions.append(reveal, remove);
      item.append(icon, meta, count, actions);
      list.appendChild(item);
    }
  }

  function renderSystem(data) {
    const media = data.media;
    const badge = $('ffmpeg-badge');
    badge.textContent = media.available ? 'Ready' : 'Optional';
    badge.className = `badge${media.available ? ' accent' : ''}`;
    $('ffmpeg-state').textContent = media.available ? (media.version || 'installed') : 'not installed';
    $('ffmpeg-state').title = media.path ?? '';
    $('ffmpeg-summary').textContent = media.available
      ? 'Thumbnails, format probing and live conversion are enabled. MKV, AVI and HEVC files will play on the phone.'
      : 'MP4, M4V, MOV and WebM play directly. Install ffmpeg to generate thumbnails and to play MKV, AVI or HEVC files.';
    $('transcode-state').textContent = media.available
      ? data.transcoding ? 'Enabled' : 'Disabled'
      : 'Needs ffmpeg';

    const pathInput = $('ffmpeg-path');
    if (document.activeElement !== pathInput && !state.ffmpegDirty) {
      pathInput.value = media.path ?? '';
    }
    pathInput.placeholder = media.available ? 'Using the detected ffmpeg' : 'Path to ffmpeg.exe (optional)';

    const toggle = $('transcode-toggle');
    toggle.checked = Boolean(data.transcoding);
    toggle.disabled = !media.available;

    const minutes = $('scan-minutes');
    if (document.activeElement !== minutes) minutes.value = String(data.autoScanMinutes);
  }

  function localhostPairUrl(data) {
    return `http://localhost:${data.port}/pair?t=${data.token}`;
  }

  function localhostEntry(data) {
    return {
      kind: 'usb',
      label: 'localhost',
      interface: 'adb reverse',
      url: `http://localhost:${data.port}`,
      pairUrl: localhostPairUrl(data),
    };
  }

  function adbReverseActive(data) {
    const needle = `tcp:${data.port}`;
    return (data.adb.reverse ?? []).some((line) => line.includes(needle));
  }

  function urlEntries(data) {
    const entries = data.urls.map((entry) => ({
      ...entry,
      kindLabel: entry.kind === 'usb' ? 'USB' : entry.kind === 'wifi' ? 'Wi-Fi' : 'LAN',
      display: entry.url,
    }));
    if (adbReverseActive(data)) entries.unshift({ ...localhostEntry(data), kindLabel: 'USB', display: `localhost:${data.port}` });
    return entries;
  }

  function renderUrls(data) {
    const entries = urlEntries(data);
    if (!entries.length) {
      state.selectedUrl = '';
      $('pair-url').value = '';
      $('qr-caption').textContent = 'No phone address yet';
      $('qr-hint').textContent = 'Connect USB tethering or put both devices on Wi-Fi.';
      drawQr(null);
      $('url-list').replaceChildren(el('p', 'fine', 'No network address found. Connect a cable with USB tethering on, or join Wi-Fi.'));
      return;
    }

    if (!entries.some((entry) => entry.pairUrl === state.selectedUrl)) {
      state.selectedUrl = entries[0].pairUrl;
    }
    const selected = entries.find((entry) => entry.pairUrl === state.selectedUrl) ?? entries[0];
    if (selected) {
      state.selectedUrl = selected.pairUrl;
      $('pair-url').value = selected.pairUrl;
      if (state.qrFor !== selected.pairUrl) {
        drawQr(selected.pairUrl);
        state.qrFor = selected.pairUrl;
      }
      $('qr-caption').textContent = `${selected.kindLabel} · ${new URL(selected.url).host}`;
      $('qr-hint').textContent = `Code ${data.token} · works without internet`;
      $('link-kind').textContent = selected.kindLabel === 'USB' ? 'USB' : selected.kindLabel;
    }

    const list = $('url-list');
    list.replaceChildren();
    for (const entry of entries) {
      const row = el('button', `url-row${entry.pairUrl === state.selectedUrl ? ' active' : ''}`);
      row.type = 'button';
      row.title = entry.pairUrl;
      row.append(
        el('span', 'url-kind', entry.kindLabel),
        el('span', 'url-value', entry.display),
      );
      const chev = el('span', 'chev');
      chev.innerHTML = '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>';
      row.appendChild(chev);
      row.addEventListener('click', () => selectUrl(entry.pairUrl, data));
      list.appendChild(row);
    }
  }

  function selectUrl(pairUrl, data = state.data) {
    if (!pairUrl) return;
    state.selectedUrl = pairUrl;
    state.qrFor = '';
    $('pair-url').value = pairUrl;
    drawQr(pairUrl);
    state.qrFor = pairUrl;
    if (data) {
      const entry = urlEntries(data).find((candidate) => candidate.pairUrl === pairUrl);
      if (entry) {
        $('qr-caption').textContent = `${entry.kindLabel} · ${new URL(entry.url).host}`;
        $('link-kind').textContent = entry.kindLabel;
      }
      renderUrlsActive();
    }
  }

  function renderUrlsActive() {
    const rows = [...document.querySelectorAll('.url-row')];
    for (const row of rows) row.classList.toggle('active', row.title === state.selectedUrl);
  }

  function drawQr(text) {
    const container = $('qr');
    container.replaceChildren();
    if (!text) {
      const empty = el('div', 'fine', 'Connect a phone link to get a QR code');
      empty.style.textAlign = 'center';
      empty.style.color = '#4d6070';
      empty.style.padding = '10px';
      container.appendChild(empty);
      return;
    }
    if (typeof qrcode !== 'function') {
      container.appendChild(el('p', 'fine', 'QR library unavailable'));
      return;
    }
    try {
      const code = qrcode(0, 'M');
      code.addData(text);
      code.make();
      const count = code.getModuleCount();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const quiet = 4;
      const budget = 212;
      const cell = Math.max(2, Math.floor(budget / (count + quiet * 2)));
      const cssSize = cell * (count + quiet * 2);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(cssSize * dpr);
      canvas.height = Math.round(cssSize * dpr);
      canvas.style.width = `${cssSize}px`;
      canvas.style.height = `${cssSize}px`;
      const context = canvas.getContext('2d');
      context.scale(dpr, dpr);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, cssSize, cssSize);
      context.fillStyle = '#061019';
      const offset = cell * quiet;
      for (let row = 0; row < count; row += 1) {
        for (let column = 0; column < count; column += 1) {
          if (!code.isDark(row, column)) continue;
          context.fillRect(offset + column * cell, offset + row * cell, cell, cell);
        }
      }
      container.appendChild(canvas);
    } catch (error) {
      container.appendChild(el('p', 'fine', 'Could not draw the QR code'));
      console.error(error);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Method panels                                                       */
  /* ------------------------------------------------------------------ */

  function methodSignature(data) {
    return JSON.stringify({
      method: state.method,
      adb: data.adb,
      usb: data.usb.map((entry) => entry.address),
      urls: data.urls.map((entry) => entry.pairUrl),
      hasUrls: data.urls.length,
      port: data.port,
      result: state.adbResult,
      reverse: adbReverseActive(data),
    });
  }

  function renderMethodPanel(data) {
    const signature = methodSignature(data);
    if (signature === state.lastMethodSignature) return;
    state.lastMethodSignature = signature;
    const panel = $('method-panel');
    panel.replaceChildren();

    for (const tab of document.querySelectorAll('.method-tabs button')) {
      const active = tab.dataset.method === state.method;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }

    if (state.method === 'adb') renderAdbMethod(panel, data);
    else if (state.method === 'tether') renderTetherMethod(panel, data);
    else renderWifiMethod(panel, data);
  }

  function stepsNode(items) {
    const list = el('ol', 'steps');
    for (const html of items) {
      const item = el('li');
      const text = el('span', 'step-text');
      text.innerHTML = html;
      item.appendChild(text);
      list.appendChild(item);
    }
    return list;
  }

  function adbTroubleshooting(data) {
    const details = el('details', 'adb-help');
    details.appendChild(el('summary', '', data.adb.available ? 'Phone prompt not showing?' : 'Where do I put adb?'));

    if (!data.adb.available) {
      details.appendChild(el('p', 'adb-help-intro', 'USB tethering and Wi-Fi work without adb. For the one-cable link, Trainu needs Android platform-tools.'));
      const install = el('ol');
      for (const item of [
        'Create a folder named platform-tools inside Trainu\'s tools folder and put adb.exe there, with its DLLs beside it.',
        'Or set ADB_PATH to the full path of adb.exe before starting Trainu.',
        'Android Studio already installs it under %LOCALAPPDATA%\\Android\\Sdk\\platform-tools; Trainu finds that automatically.',
        'Refresh this panel after adding it.',
      ]) {
        install.appendChild(el('li', '', item));
      }
      details.appendChild(install);
      return details;
    }

    details.appendChild(el('p', 'adb-help-intro', 'Android only shows "Allow USB debugging?" when this laptop is not authorized yet. If you already tapped Allow once, Trainu connects without a new prompt.'));
    const list = el('ol');
    for (const item of [
      'Unlock the phone. The dialog cannot appear over the lock screen.',
      'Pull down the USB notification and choose File transfer. "Charging only" hides adb.',
      'Open Developer options → Revoke USB debugging authorizations, then unplug and replug the cable.',
      'Turn USB debugging off and on again, then press Connect phone.',
      'Try another cable and a port directly on the laptop, not through a hub.',
    ]) {
      list.appendChild(el('li', '', item));
    }
    details.appendChild(list);
    details.appendChild(el('p', 'adb-help-note', 'Xiaomi / HyperOS: allow the USB debugging dialog and keep USB debugging on. The "USB debugging (Security settings)" switch is for simulated input; Trainu does not need it.'));
    return details;
  }

  function renderAdbMethod(panel, data) {
    panel.append(
      el('h3', '', 'One cable, no network at all'),
      el('p', '', 'The most reliable link. Trainu runs adb reverse, so the phone opens localhost and reaches this laptop through the cable.'),
    );
    panel.appendChild(stepsNode([
      'On the phone, open <b>Settings → About phone</b> and tap <b>Build number</b> seven times.',
      'In <b>Developer options</b>, turn on <b>USB debugging</b>. Plug in the cable and choose <b>File transfer</b> in the phone notification.',
      'Press <b>Connect phone</b>. Unlock the phone and tap <b>Allow</b> on <b>Allow USB debugging?</b>; tick <b>Always allow from this computer</b>.',
      `Trainu finishes the link and shows the localhost QR. Scan it, or open <b>http://localhost:${data.port}</b> on the phone.`,
    ]));

    const active = adbReverseActive(data);
    const actions = el('div', 'method-actions');
    const enable = el(
      'button',
      'btn btn-primary btn-sm',
      state.usbBusy ? 'Waiting for phone…' : active ? 'Refresh link' : 'Connect phone',
    );
    enable.type = 'button';
    enable.disabled = !data.adb.available || state.usbBusy;
    enable.addEventListener('click', () => enableUsb(data));
    const showLocal = el('button', 'btn btn-sm', 'Show localhost QR');
    showLocal.type = 'button';
    showLocal.disabled = !data.adb.available || state.usbBusy;
    showLocal.addEventListener('click', () => {
      selectUrl(localhostPairUrl(data), data);
      toast('Scan this on the USB-connected phone');
    });
    actions.append(enable, showLocal);
    panel.appendChild(actions);

    const status = el('div', 'method-note adb-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    if (!data.adb.available) {
      status.appendChild(el('p', '', 'adb was not found. USB tethering and Wi-Fi still work; for the one-cable link, add Android platform-tools.'));
    } else if (state.usbBusy) {
      const wait = el('div', 'adb-wait');
      wait.append(el('span', 'dot'), el('span', '', 'Waiting for the phone…'));
      status.appendChild(wait);
      status.appendChild(el('p', 'adb-hint', 'Unlock the phone and tap Allow. Trainu finishes automatically once the phone is authorized.'));
    } else {
      const connected = data.adb.devices.filter((device) => device.state === 'device');
      const unauthorized = data.adb.devices.filter((device) => device.state === 'unauthorized');
      if (connected.length) {
        const row = el('div', 'adb-device-row');
        for (const device of connected) {
          row.appendChild(el('span', 'device-pill', `● ${device.model || device.serial}`));
        }
        row.append(el('span', 'fine', active ? 'USB link active' : 'Authorized. Press Connect phone to finish the link.'));
        status.appendChild(row);
      } else if (unauthorized.length) {
        const wait = el('div', 'adb-wait');
        wait.append(el('span', 'dot'), el('span', '', 'Phone found, waiting for Allow'));
        status.appendChild(wait);
        status.appendChild(el('p', 'adb-hint', 'Unlock the phone and tap Allow. If no dialog appears, use the steps below.'));
      } else if (data.adb.error) {
        status.appendChild(el('p', '', `adb is installed but would not start: ${data.adb.error}`));
      } else {
        status.appendChild(el('p', '', 'adb is ready, but no phone is visible. Connect the cable, choose File transfer, and check that USB debugging is on.'));
      }
    }
    panel.appendChild(status);

    if (state.adbResult) {
      const result = el('div', `adb-result ${state.adbResult.ok ? 'ok' : 'bad'}`, state.adbResult.message || '');
      panel.appendChild(result);
    }

    panel.appendChild(adbTroubleshooting(data));
  }

  function renderTetherMethod(panel, data) {
    panel.append(
      el('h3', '', 'USB tethering, no developer mode'),
      el('p', '', 'The phone shares a wired network with the laptop over the same cable. No mobile data is used by Trainu.'),
    );
    panel.appendChild(stepsNode([
      'Connect the USB cable.',
      'On Android, open <b>Settings → Hotspot & tethering</b> and turn on <b>USB tethering</b>.',
      'Wait a few seconds. A new USB network appears in the list below.',
      'Scan the QR code. If you want the laptop fully offline, turn mobile data off first.',
    ]));

    if (data.usb.length) {
      const actions = el('div', 'method-actions');
      for (const entry of data.usb) {
        const button = el('button', 'btn btn-sm', `Use ${entry.address}`);
        button.type = 'button';
        button.addEventListener('click', () => selectUrl(entry.pairUrl, data));
        actions.appendChild(button);
      }
      panel.appendChild(actions);
    } else {
      panel.appendChild(el('div', 'method-note', 'No USB network detected yet. Turn on USB tethering and give it a moment; the QR updates by itself.'));
    }

    panel.appendChild(el('div', 'method-note', 'iPhone note: iOS USB tethering only shares internet to the laptop and does not expose a USB network to apps. Use Wi-Fi from the same router — it stays entirely local.'));
  }

  function renderWifiMethod(panel, data) {
    panel.append(
      el('h3', '', 'Same room, same Wi-Fi'),
      el('p', '', 'No internet needed. Both devices simply need to be on the same router, even one without an uplink.'),
    );
    panel.appendChild(stepsNode([
      'Keep the phone and laptop on the same Wi-Fi network.',
      'Pick a Wi-Fi address below and scan its QR code.',
      'If the phone cannot connect, allow the port through Windows Firewall using the section in Playback engine.',
    ]));

    const wifi = data.urls.filter((entry) => entry.kind !== 'usb');
    if (wifi.length) {
      const actions = el('div', 'method-actions');
      for (const entry of wifi) {
        const button = el('button', 'btn btn-sm', entry.label === 'Wi-Fi' ? entry.address : `${entry.interface} · ${entry.address}`);
        button.type = 'button';
        button.addEventListener('click', () => selectUrl(entry.pairUrl, data));
        actions.appendChild(button);
      }
      panel.appendChild(actions);
    } else {
      panel.appendChild(el('div', 'method-note', 'No Wi-Fi address detected. Join a wireless network, then refresh this panel.'));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  async function enableUsb(data) {
    if (state.usbBusy) return;
    state.usbBusy = true;
    state.adbResult = null;
    state.lastMethodSignature = '';
    renderMethodPanel(data);

    try {
      const result = await api('/api/admin/usb/reverse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Keep the request open long enough for the Android RSA dialog to be
        // answered. The server restarts adb first when authorization is stale.
        body: JSON.stringify({ waitMs: 20000 }),
      });
      state.adbResult = result;
      if (result.ok) {
        toast('USB link ready — open localhost on the phone');
        const fresh = state.data ?? data;
        selectUrl(localhostPairUrl(fresh), fresh);
      } else if (result.reason === 'unauthorized') {
        toast('Phone found. Tap Allow on the phone, then press Connect phone again.');
      } else {
        toast(result.message || 'Could not set up the USB link', { error: true });
      }
    } catch (error) {
      state.adbResult = error.payload ?? { ok: false, message: error.message };
      toast(error.message, { error: true });
    } finally {
      state.usbBusy = false;
      state.lastMethodSignature = '';
      await refresh({ quiet: false });
    }
  }

  async function rescan(button) {
    button.disabled = true;
    try {
      await api('/api/admin/scan', { method: 'POST' });
      toast('Scanning folders…');
      state.lastMethodSignature = '';
      setTimeout(() => refresh({ quiet: false }), 500);
    } catch (error) {
      toast(error.message, { error: true });
      button.disabled = false;
    }
  }

  async function addFolder(event) {
    event.preventDefault();
    const input = $('folder-path');
    const value = input.value.trim();
    const errorNode = $('folder-error');
    errorNode.hidden = true;
    if (!value) {
      errorNode.textContent = 'Enter a folder path first.';
      errorNode.hidden = false;
      return;
    }
    const button = document.querySelector('#add-folder-form button');
    button.disabled = true;
    button.textContent = 'Adding…';
    try {
      await api('/api/admin/folders', { method: 'POST', body: JSON.stringify({ path: value }) });
      input.value = '';
      toast('Folder added — scanning it now');
      await refresh({ quiet: false });
    } catch (error) {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Add folder';
    }
  }

  async function removeFolder(folder) {
    if (!confirm(`Remove “${folder.label}” from the library?\n\nThe files stay on disk.`)) return;
    try {
      await api(`/api/admin/folders/${folder.id}`, { method: 'DELETE' });
      toast('Folder removed');
      await refresh({ quiet: false });
    } catch (error) {
      toast(error.message, { error: true });
    }
  }

  async function revealFolder(folderId) {
    try {
      await api('/api/admin/reveal', { method: 'POST', body: JSON.stringify({ folderId }) });
    } catch (error) {
      toast(error.message, { error: true });
    }
  }

  async function saveFfmpeg() {
    const button = $('save-ffmpeg');
    const value = $('ffmpeg-path').value.trim();
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      const result = await api('/api/admin/config', { method: 'POST', body: JSON.stringify({ ffmpegPath: value }) });
      if (result.media?.available) toast('ffmpeg detected — thumbnails and conversion are on');
      else toast(value ? 'That path did not work; ffmpeg not found' : 'ffmpeg path cleared', { error: Boolean(value) });
      state.ffmpegDirty = false;
      state.lastMethodSignature = '';
      await refresh({ quiet: true });
    } catch (error) {
      toast(error.message, { error: true });
    } finally {
      button.disabled = false;
      button.textContent = 'Save';
    }
  }

  async function updateConfig(patch, message) {
    try {
      await api('/api/admin/config', { method: 'POST', body: JSON.stringify(patch) });
      if (message) toast(message);
      await refresh({ quiet: true });
    } catch (error) {
      toast(error.message, { error: true });
    }
  }

  async function copyText(text, message) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast(message);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        toast(message);
      } catch {
        toast('Could not copy — select the text instead', { error: true });
      }
      textarea.remove();
    }
  }

  function renderLog(data) {
    const entries = [...data.log].reverse().slice(0, 50);
    const signature = `${entries.length}:${entries[0]?.at ?? ''}`;
    if (signature === state.lastLogSignature) return;
    state.lastLogSignature = signature;
    const list = $('log');
    list.replaceChildren();
    if (!entries.length) {
      list.appendChild(el('li', 'log-empty', 'No activity yet.'));
      return;
    }
    for (const entry of entries) {
      const item = el('li');
      item.append(
        el('time', '', clock(entry.at)),
        el('span', `level ${entry.level}`, entry.level),
      );
      const message = el('span', 'message', entry.message);
      if (entry.fields) {
        const fields = el('span', 'fields', Object.entries(entry.fields).map(([key, value]) => `${key}=${value}`).join('  '));
        message.appendChild(fields);
      }
      item.appendChild(message);
      list.appendChild(item);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  function setMethod(method) {
    state.method = method;
    state.adbResult = null;
    state.lastMethodSignature = '';
    if (!state.data) return;
    render(dataSafe());
    if (method === 'adb' && adbReverseActive(state.data)) {
      selectUrl(localhostPairUrl(state.data), state.data);
    } else if (method === 'tether') {
      const usb = state.data.urls.find((entry) => entry.kind === 'usb');
      if (usb) selectUrl(usb.pairUrl, state.data);
    } else if (method === 'wifi') {
      const wifi = state.data.urls.find((entry) => entry.kind !== 'usb');
      if (wifi) selectUrl(wifi.pairUrl, state.data);
    }
    renderMethodPanel(state.data);
  }

  function dataSafe() {
    return state.data;
  }

  function bind() {
    document.querySelector('.method-tabs').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-method]');
      if (button) setMethod(button.dataset.method);
    });

    $('rescan').addEventListener('click', (event) => rescan(event.currentTarget));
    $('rescan-top').addEventListener('click', (event) => rescan(event.currentTarget));

    $('add-folder-form').addEventListener('submit', addFolder);

    $('copy-url').addEventListener('click', () => copyText($('pair-url').value, 'Pairing link copied'));
    $('copy-firewall').addEventListener('click', () => copyText($('firewall-cmd').textContent, 'Firewall command copied'));

    $('save-ffmpeg').addEventListener('click', saveFfmpeg);
    $('ffmpeg-path').addEventListener('input', () => { state.ffmpegDirty = true; });
    $('ffmpeg-path').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveFfmpeg();
      }
    });

    $('transcode-toggle').addEventListener('change', (event) => {
      updateConfig({ transcoding: event.target.checked }, event.target.checked ? 'Live conversion enabled' : 'Live conversion disabled');
    });

    $('scan-minutes').addEventListener('change', (event) => {
      const value = Number(event.target.value);
      if (!Number.isInteger(value) || value < 0 || value > 1440) {
        toast('Use a number between 0 and 1440 minutes', { error: true });
        return;
      }
      updateConfig({ autoScanMinutes: value }, value === 0 ? 'Automatic scanning off' : `Rescanning every ${value} minutes`);
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh({ quiet: true });
    });
  }

  bind();
  refresh({ quiet: false }).then(() => scheduleRefresh(2500));
})();
