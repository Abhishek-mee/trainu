(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CACHE_KEY = 'trainu:library:v1';
  const SORT_KEY = 'trainu:sort';
  const failedThumbs = new Set();
  const icon = (name, className = '') => `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  const state = {
    library: null,
    loading: true,
    offline: false,
    tab: 'library',
    collection: 'all',
    sort: 'recent',
    query: '',
    scanningPolls: 0,
    scanTimer: null,
    fetchPromise: null,
    player: null,
    installPrompt: null,
    featuredItem: null,
    featuredId: null,
    lastRendered: '',
  };

  const els = {
    topbar: $('topbar'),
    connPill: $('conn-pill'),
    connText: $('conn-text'),
    searchToggle: $('search-toggle'),
    searchbar: $('searchbar'),
    searchInput: $('search-input'),
    searchClear: $('search-clear'),
    searchCancel: $('search-cancel'),
    hero: $('hero'),
    heroImage: $('hero-image'),
    heroEyebrow: $('hero-eyebrow'),
    heroTitle: $('hero-title'),
    heroCount: $('hero-count'),
    heroSize: $('hero-size'),
    heroState: $('hero-state'),
    heroActions: $('hero-actions'),
    heroPlay: $('hero-play'),
    heroPlayLabel: $('hero-play-label'),
    heroBrowse: $('hero-browse'),
    offlineBanner: $('offline-banner'),
    continueSection: $('continue-section'),
    continueRail: $('continue-rail'),
    continueMeta: $('continue-meta'),
    sectionTitle: $('section-title'),
    sortSelect: $('sort-select'),
    chips: $('chips'),
    scanningNote: $('scanning-note'),
    scanningText: $('scanning-text'),
    skeleton: $('skeleton'),
    grid: $('grid'),
    foldersView: $('folders-view'),
    foldersEmpty: $('folders-empty'),
    folderList: $('folder-list'),
    settingsView: $('settings-view'),
    empty: $('empty'),
    emptyTitle: $('empty-title'),
    emptyText: $('empty-text'),
    emptyAction: $('empty-action'),
    settingsPill: $('settings-pill'),
    settingsUrl: $('settings-url'),
    settingsMode: $('settings-mode'),
    settingsLibrary: $('settings-library'),
    settingsScan: $('settings-scan'),
    settingsDevice: $('settings-device'),
    settingsFfmpeg: $('settings-ffmpeg'),
    appVersion: $('app-version'),
    installBtn: $('install-btn'),
    installHint: $('install-hint'),
    clearProgress: $('clear-progress'),
    refreshBtn: $('refresh-btn'),
    toast: $('toast'),
    player: $('player'),
  };

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

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
    const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded} ${units[unit]}`;
  }

  function formatClock(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function timeAgo(timestamp) {
    if (!timestamp) return 'never';
    const seconds = Math.max(0, (Date.now() - Number(timestamp)) / 1000);
    if (seconds < 45) return 'just now';
    if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
    if (seconds < 172800) return 'yesterday';
    return `${Math.round(seconds / 86400)} days ago`;
  }

  function linkMode() {
    const host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'USB link';
    if (host.startsWith('192.168.42.') || host.startsWith('172.20.10.')) return 'USB tethering';
    return 'Wi-Fi';
  }

  function hueFor(id) {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
      hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
    }
    return 205 + (hash % 30);
  }

  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
  };

  let toastTimer = null;
  function toast(message, { error = false, duration = 2800 } = {}) {
    els.toast.textContent = message;
    els.toast.classList.toggle('error', error);
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), duration);
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers ?? {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { cache: 'no-store', ...options, headers });
    if (response.status === 401) {
      location.replace('/pair');
      throw new Error('Pairing required');
    }
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const payload = await response.json();
        if (payload.message) message = payload.message;
        else if (payload.error) message = payload.error;
      } catch { /* ignore */ }
      throw Object.assign(new Error(message), { status: response.status });
    }
    if (response.status === 204) return null;
    return response.json();
  }

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function progressOf(item) {
    const progress = item.progress;
    if (!progress || !Number.isFinite(progress.pos)) return null;
    return progress;
  }

  function isInProgress(item) {
    const progress = progressOf(item);
    if (!progress || progress.finished) return false;
    if (progress.pos < 5) return false;
    if (progress.dur > 0 && progress.pos > progress.dur - 10) return false;
    return true;
  }

  function progressPercent(item) {
    const progress = progressOf(item);
    if (!progress || !progress.dur || progress.dur <= 0) return 0;
    return Math.min(100, Math.max(0, (progress.pos / progress.dur) * 100));
  }

  function remainingLabel(item) {
    const progress = progressOf(item);
    if (!progress || !progress.dur) return '';
    const remaining = Math.max(0, progress.dur - progress.pos);
    if (remaining < 60) return 'almost done';
    return `${Math.ceil(remaining / 60)} min left`;
  }

  /* ------------------------------------------------------------------ */
  /* Library loading                                                     */
  /* ------------------------------------------------------------------ */

  async function loadLibrary({ initial = false, quiet = false } = {}) {
    if (state.fetchPromise) return state.fetchPromise;
    state.fetchPromise = (async () => {
      try {
        const data = await api('/api/library');
        const fingerprint = `${data.scannedAt}|${data.revision ?? 0}|${data.count}|${data.totalBytes}|${data.deviceId}|${data.scanning}|${data.items.reduce((sum, item) => sum + (item.progress?.updated ?? 0), 0)}`;
        const changed = state.lastRendered !== fingerprint;
        state.library = data;
        state.offline = false;
        state.loading = false;
        state.lastRendered = fingerprint;
        storage.set(CACHE_KEY, { savedAt: Date.now(), data });
        if (!data.scanning) state.scanningPolls = 0;
        if (changed || initial || !quiet) renderAll();
        else renderConnection();
        if (data.scanning) scheduleScanPoll();
      } catch (error) {
        state.loading = false;
        const cached = storage.get(CACHE_KEY, null);
        if (!state.library && cached?.data) state.library = cached.data;
        state.offline = true;
        if (error.status === 401) return;
        renderConnection();
        if (!quiet) {
          if (state.library) {
            renderAll();
            toast('Showing the last saved library — the laptop is unreachable', { error: true, duration: 4000 });
          } else {
            renderAll();
            showEmpty('Can\'t reach the laptop', 'Check the USB cable or Wi-Fi, keep Trainu running on the laptop, then try again.', 'Try again');
          }
        }
      } finally {
        state.fetchPromise = null;
      }
    })();
    return state.fetchPromise;
  }

  function scheduleScanPoll() {
    clearTimeout(state.scanTimer);
    if (!state.library?.scanning) return;
    if (state.scanningPolls > 120) return;
    state.scanningPolls += 1;
    state.scanTimer = setTimeout(() => loadLibrary({ quiet: true }), 1500);
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function renderAll() {
    const data = state.library;
    const searching = Boolean(state.query);
    renderConnection();
    renderHero(searching);
    renderChips();

    const showGrid = !searching && (state.tab === 'library' || state.tab === 'continue');
    const showSearchGrid = searching;
    const showFolders = !searching && state.tab === 'folders';
    const showSettings = !searching && state.tab === 'settings';

    els.skeleton.hidden = !(state.loading && !data);
    els.grid.hidden = !(showGrid || showSearchGrid);
    els.foldersView.hidden = !showFolders;
    els.settingsView.hidden = !showSettings;
    els.continueSection.hidden = !(showGrid && state.tab === 'library' && hasContinueItems());
    els.empty.hidden = true;
    els.sortSelect.closest('.section-head').hidden = !(showGrid || showSearchGrid);
    els.chips.hidden = !showGrid || searching;
    els.scanningNote.hidden = !(data?.scanning && showGrid);

    if (showFolders) renderFolders();
    if (showSettings) renderSettings();

    if (showGrid || showSearchGrid) {
      const items = visibleItems();
      els.sectionTitle.textContent = searching
        ? `Results for “${state.query}”`
        : state.tab === 'continue'
          ? 'In progress'
          : state.collection === 'all'
            ? 'All videos'
            : state.collection;
      renderContinueRail();
      renderGrid(items, searching);
      els.scanningText.textContent = data?.scanning
        ? `Reading video folders… ${data.count ? `${data.count} found so far.` : ''}`
        : '';
    }

    if (showFolders) {
      els.sectionTitle.textContent = 'Folders';
      els.sectionTitle.closest('.section-head').hidden = true;
    } else if (showSettings) {
      els.sectionTitle.textContent = 'Settings';
      els.sectionTitle.closest('.section-head').hidden = true;
    } else if (showGrid || showSearchGrid) {
      els.sectionTitle.closest('.section-head').hidden = false;
    }

    renderTabbar();
  }

  function renderConnection() {
    const online = Boolean(state.library) && !state.offline;
    const connecting = !state.library && state.loading;
    els.connPill.className = `pill ${online ? 'online' : connecting ? '' : 'offline'}`;
    els.connText.textContent = online ? 'Connected' : connecting ? 'Connecting' : 'Offline';
    els.offlineBanner.hidden = !(state.offline && state.library);
    if (online) els.heroState.textContent = `over ${linkMode()}`;
    else els.heroState.textContent = connecting ? 'looking for the laptop' : 'last saved copy';
    if (els.settingsPill) {
      els.settingsPill.className = `pill ${online ? 'online' : connecting ? '' : 'offline'}`;
      els.settingsPill.innerHTML = `<i class="dot"></i><span>${online ? 'Connected' : connecting ? 'Connecting' : 'Offline'}</span>`;
    }
  }

  function renderHero(searching) {
    const data = state.library;
    const titles = { library: 'Library', continue: 'Continue watching', folders: 'Folders', settings: 'Settings' };
    const compactTab = Boolean(searching) || state.tab === 'folders' || state.tab === 'settings';
    const featured = compactTab ? null : featuredItem();
    const compact = compactTab || (Boolean(data) && !featured);
    state.featuredItem = featured;
    els.hero.classList.toggle('compact', compact);

    if (searching) {
      els.heroEyebrow.textContent = 'Search your library';
      els.heroTitle.textContent = 'Search';
    } else if (state.tab === 'folders') {
      els.heroEyebrow.textContent = 'Chosen on the laptop';
      els.heroTitle.textContent = 'Folders';
    } else if (state.tab === 'settings') {
      els.heroEyebrow.textContent = 'This phone';
      els.heroTitle.textContent = 'Settings';
    } else if (featured) {
      els.heroEyebrow.textContent = isInProgress(featured) ? 'Continue watching' : 'Newest on the laptop';
      els.heroTitle.textContent = featured.title;
    } else {
      els.heroEyebrow.textContent = 'Your laptop\'s library';
      els.heroTitle.textContent = titles[state.tab] ?? 'Library';
    }

    if (!data) {
      els.heroCount.textContent = state.offline ? 'Library unavailable' : 'Connecting…';
      els.heroSize.textContent = '—';
      els.heroActions.hidden = true;
      state.featuredId = null;
      els.heroImage.classList.remove('loaded');
      els.heroImage.removeAttribute('src');
      return;
    }

    const items = searching ? visibleItems() : data.items;
    els.heroCount.textContent = searching
      ? `${items.length} ${items.length === 1 ? 'match' : 'matches'}`
      : `${data.count} ${data.count === 1 ? 'video' : 'videos'}`;
    els.heroSize.textContent = formatBytes(
      searching ? items.reduce((total, item) => total + item.size, 0) : data.totalBytes,
    );

    if (!featured) {
      els.heroActions.hidden = true;
      state.featuredId = null;
      els.heroImage.classList.remove('loaded');
      els.heroImage.removeAttribute('src');
      return;
    }

    els.heroActions.hidden = false;
    const resuming = isInProgress(featured);
    els.heroPlayLabel.textContent = resuming ? 'Resume' : 'Play';
    els.heroPlay.setAttribute('aria-label', `${resuming ? 'Resume' : 'Play'} ${featured.title}`);

    if (state.featuredId !== featured.id) {
      state.featuredId = featured.id;
      els.heroImage.classList.remove('loaded');
      els.heroImage.onload = () => els.heroImage.classList.add('loaded');
      els.heroImage.onerror = () => els.heroImage.classList.remove('loaded');
      els.heroImage.src = `/api/thumbnails/${featured.id}.jpg`;
    }
  }

  function featuredItem() {
    const items = state.library?.items;
    if (!items?.length) return null;
    const inProgress = items
      .filter(isInProgress)
      .sort((a, b) => (b.progress?.updated ?? 0) - (a.progress?.updated ?? 0));
    if (state.tab === 'continue') return inProgress[0] ?? null;
    if (inProgress.length) return inProgress[0];
    return [...items].sort((a, b) => b.mtime - a.mtime)[0] ?? null;
  }

  function renderChips() {
    const data = state.library;
    if (!data) {
      els.chips.innerHTML = '';
      return;
    }
    const counts = new Map();
    for (const item of data.items) counts.set(item.collection, (counts.get(item.collection) ?? 0) + 1);
    const collections = [...counts.keys()].sort((a, b) => a.localeCompare(b));
    const fragment = document.createDocumentFragment();

    const all = document.createElement('button');
    all.className = `chip${state.collection === 'all' ? ' active' : ''}`;
    all.type = 'button';
    all.dataset.collection = 'all';
    all.innerHTML = `<span>All</span><span class="count">${data.count}</span>`;
    fragment.appendChild(all);

    for (const collection of collections) {
      if (collection === 'all') continue;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `chip${state.collection === collection ? ' active' : ''}`;
      chip.dataset.collection = collection;
      const label = document.createElement('span');
      label.textContent = collection;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = String(counts.get(collection));
      chip.append(label, count);
      fragment.appendChild(chip);
    }
    els.chips.replaceChildren(fragment);
  }

  function visibleItems() {
    const data = state.library;
    if (!data) return [];
    let items = data.items;

    if (state.query) {
      const query = state.query.toLowerCase();
      items = items.filter((item) => `${item.title} ${item.file} ${item.collection}`.toLowerCase().includes(query));
      return sortItems(items);
    }

    if (state.tab === 'continue') {
      items = items.filter(isInProgress);
      return items.sort((a, b) => (b.progress?.updated ?? 0) - (a.progress?.updated ?? 0));
    }

    if (state.collection !== 'all') items = items.filter((item) => item.collection === state.collection);
    return sortItems(items);
  }

  function sortItems(items) {
    const list = [...items];
    switch (state.sort) {
      case 'name':
        return list.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
      case 'size':
        return list.sort((a, b) => b.size - a.size);
      case 'duration':
        return list.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
      default:
        return list.sort((a, b) => b.mtime - a.mtime);
    }
  }

  function makeCard(item, index = 0) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card';
    button.dataset.id = item.id;
    button.setAttribute('aria-label', `Play ${item.title}`);

    const thumb = document.createElement('div');
    thumb.className = 'thumb';

    const fallback = document.createElement('div');
    fallback.className = 'thumb-fallback';
    fallback.style.setProperty('--hue', String(hueFor(item.id)));
    fallback.innerHTML = `${icon('film')}<span class="fallback-ext"></span>`;
    fallback.querySelector('.fallback-ext').textContent = item.ext.replace('.', '').slice(0, 4).toUpperCase();
    thumb.appendChild(fallback);

    if (item.thumb || (state.library?.ffmpeg && !failedThumbs.has(item.id))) {
      const image = document.createElement('img');
      image.loading = index < 6 ? 'eager' : 'lazy';
      image.fetchPriority = index < 3 ? 'high' : 'auto';
      image.decoding = 'async';
      image.alt = '';
      image.src = `/api/thumbnails/${item.id}.jpg`;
      image.addEventListener('load', () => {
        image.classList.add('loaded');
        fallback.remove();
      });
      image.addEventListener('error', () => {
        failedThumbs.add(item.id);
        image.remove();
      });
      thumb.appendChild(image);
    }

    const shade = document.createElement('div');
    shade.className = 'thumb-shade';
    thumb.appendChild(shade);

    if (item.height >= 720) {
      const quality = document.createElement('span');
      quality.className = 'badge right';
      quality.textContent = item.height >= 2000 ? '4K' : `${item.height}p`;
      thumb.appendChild(quality);
    }

    if (item.duration) {
      const duration = document.createElement('span');
      duration.className = 'duration';
      duration.textContent = formatClock(item.duration);
      thumb.appendChild(duration);
    }

    const percent = progressPercent(item);
    if (percent > 1 && percent < 99.5) {
      const progress = document.createElement('div');
      progress.className = 'card-progress';
      const fill = document.createElement('span');
      fill.style.width = `${percent}%`;
      progress.appendChild(fill);
      thumb.appendChild(progress);
    }

    const title = document.createElement('p');
    title.className = 'card-title';
    title.textContent = item.title;

    const meta = document.createElement('p');
    meta.className = 'card-meta';
    const parts = [];
    if (item.episode) parts.push(item.episode);
    if (progressOf(item)?.finished) parts.push('Watched');
    else if (remainingLabel(item)) parts.push(remainingLabel(item));
    parts.push(formatBytes(item.size));
    meta.textContent = parts.join(' · ');

    button.append(thumb, title, meta);
    if (progressOf(item)?.finished) button.classList.add('watched');
    return button;
  }

  function renderGrid(items, searching) {
    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => fragment.appendChild(makeCard(item, index)));
    els.grid.replaceChildren(fragment);

    if (!items.length) {
      if (state.loading && !state.library) {
        els.grid.hidden = true;
        return;
      }
      if (searching) {
        showEmpty('No matches', `Nothing in your library matches “${state.query}”.`, 'Clear search');
      } else if (state.tab === 'continue') {
        showEmpty('Nothing in progress', 'Start watching something and it will wait for you here, even after you close the app.', 'Browse library');
      } else if (state.collection !== 'all') {
        showEmpty('This folder is empty', 'No playable videos were found in this folder.', 'Show all videos');
      } else if (state.offline) {
        showEmpty('Can\'t reach the laptop', 'Reconnect the USB cable or Wi-Fi. Your last library is saved here.', 'Try again');
      } else {
        showEmpty('No videos yet', 'Add a folder containing videos from the Trainu control panel on the laptop. It rescans automatically.', null);
      }
    }
  }

  function showEmpty(title, text, actionLabel) {
    els.empty.hidden = false;
    els.emptyTitle.textContent = title;
    els.emptyText.textContent = text;
    els.emptyAction.hidden = !actionLabel;
    if (actionLabel) {
      els.emptyAction.textContent = actionLabel;
      els.emptyAction.onclick = () => {
        if (actionLabel === 'Clear search') closeSearch();
        else if (actionLabel === 'Try again') loadLibrary({ initial: true });
        else if (actionLabel === 'Browse library') switchTab('library');
        else {
          state.collection = 'all';
          switchTab('library');
        }
      };
    }
  }

  function hasContinueItems() {
    return Boolean(state.library?.items.some(isInProgress));
  }

  function renderContinueRail() {
    const data = state.library;
    if (!data) return;
    const items = data.items
      .filter(isInProgress)
      .sort((a, b) => (b.progress?.updated ?? 0) - (a.progress?.updated ?? 0))
      .slice(0, 12);
    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => fragment.appendChild(makeCard(item, index)));
    els.continueRail.replaceChildren(fragment);
    els.continueMeta.textContent = items.length ? `${items.length} ${items.length === 1 ? 'video' : 'videos'}` : '';
  }

  function renderFolders() {
    const data = state.library;
    if (!data) return;
    const groups = new Map();
    for (const item of data.items) {
      const group = groups.get(item.collection) ?? { name: item.collection, count: 0, bytes: 0, folderLabel: item.folderLabel };
      group.count += 1;
      group.bytes += item.size;
      groups.set(item.collection, group);
    }
    const entries = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
    els.foldersEmpty.hidden = entries.length > 0;
    const fragment = document.createDocumentFragment();
    for (const group of entries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'folder-row';
      row.innerHTML = `
        <span class="folder-icon">${icon('folder')}</span>
        <span class="folder-body"><span class="folder-name"></span><span class="folder-sub"></span></span>
        <span class="chev">${icon('chevron')}</span>`;
      row.querySelector('.folder-name').textContent = group.name;
      row.querySelector('.folder-sub').textContent = `${group.count} ${group.count === 1 ? 'video' : 'videos'} · ${formatBytes(group.bytes)}`;
      row.addEventListener('click', () => {
        state.collection = group.name;
        state.query = '';
        switchTab('library');
      });
      fragment.appendChild(row);
    }
    els.folderList.replaceChildren(fragment);
  }

  function renderSettings() {
    const data = state.library;
    els.settingsUrl.textContent = location.host;
    els.settingsMode.textContent = linkMode();
    els.settingsDevice.textContent = data?.deviceId ? data.deviceId.slice(0, 8) : '—';
    els.settingsLibrary.textContent = data ? `${data.count} videos · ${formatBytes(data.totalBytes)}` : '—';
    els.settingsScan.textContent = data?.scanning ? 'Scanning…' : data?.scannedAt ? timeAgo(data.scannedAt) : 'not yet';
    els.settingsFfmpeg.textContent = data?.transcoding ? 'All formats (ffmpeg ready)' : 'MP4 & WebM (install ffmpeg for more)';
    els.appVersion.textContent = data?.version ? `v${data.version}` : '';
    els.installBtn.hidden = !state.installPrompt;
    if (!state.installPrompt) {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      els.installHint.textContent = ios
        ? 'In Safari, tap Share → Add to Home Screen. It opens full screen, straight to your library.'
        : 'In your browser menu choose “Add to Home screen” or “Install app”. It opens full screen, straight to your library.';
    }
  }

  function renderTabbar() {
    for (const button of document.querySelectorAll('.tabbar button')) {
      const active = button.dataset.tab === state.tab && !state.query;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }

  function renderEverything() {
    renderAll();
  }

  /* ------------------------------------------------------------------ */
  /* Interaction                                                         */
  /* ------------------------------------------------------------------ */

  function switchTab(tab) {
    state.tab = tab;
    state.query = '';
    els.searchInput.value = '';
    els.searchClear.hidden = true;
    els.searchbar.hidden = true;
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openSearch() {
    els.searchbar.hidden = false;
    els.searchToggle.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => els.searchInput.focus());
  }

  function closeSearch() {
    state.query = '';
    els.searchInput.value = '';
    els.searchClear.hidden = true;
    els.searchbar.hidden = true;
    els.searchToggle.setAttribute('aria-expanded', 'false');
    renderAll();
  }

  function openPlayer(item, queue) {
    if (!window.TrainuPlayer) {
      toast('Player script did not load. Reload the page.', { error: true });
      return;
    }
    if (!state.player) {
      state.player = new window.TrainuPlayer({
        cachePrefix: 'trainu',
        onSave: (savedItem, position, duration, finished) => {
          saveProgress(savedItem, position, duration, finished);
        },
        onClose: () => {
          renderAll();
          if (history.state?.trainuPlayer) history.back();
        },
      });
    }
    if (!history.state?.trainuPlayer) history.pushState({ trainuPlayer: true }, '');

    const current = state.library?.items.find((entry) => entry.id === item.id) ?? item;
    state.player.open({
      item: current,
      queue,
      canConvert: Boolean(state.library?.transcoding),
      thumbUrl: current.thumb ? `/api/thumbnails/${current.id}.jpg` : null,
    });
  }

  const saveProgress = (item, position, duration, finished) => {
    if (!item?.id || !Number.isFinite(position)) return;
    const payload = { id: item.id, position, duration, finished };
    fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
    const target = state.library?.items.find((entry) => entry.id === item.id);
    if (target) {
      target.progress = {
        pos: position,
        dur: duration,
        updated: Date.now(),
        finished: Boolean(finished),
      };
    }
  };

  function clearProgress() {
    if (!confirm('Clear all saved resume positions for this phone?')) return;
    api('/api/progress/clear', { method: 'POST', body: JSON.stringify({ all: true }) })
      .then(() => {
        for (const item of state.library?.items ?? []) item.progress = null;
        renderAll();
        toast('Watch progress cleared');
      })
      .catch((error) => toast(error.message, { error: true }));
  }

  function bindUI() {
    document.querySelector('.tabbar').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-tab]');
      if (button) switchTab(button.dataset.tab);
    });

    els.grid.addEventListener('click', (event) => {
      const card = event.target.closest('.card');
      if (!card) return;
      const item = state.library?.items.find((entry) => entry.id === card.dataset.id);
      if (item) openPlayer(item, visibleItems());
    });

    els.continueRail.addEventListener('click', (event) => {
      const card = event.target.closest('.card');
      if (!card) return;
      const item = state.library?.items.find((entry) => entry.id === card.dataset.id);
      if (item) openPlayer(item, state.library.items.filter(isInProgress));
    });

    els.heroPlay.addEventListener('click', () => {
      const item = state.featuredItem;
      if (item) openPlayer(item, state.library?.items ?? []);
    });

    els.heroBrowse.addEventListener('click', () => {
      const target = document.querySelector('.section-head') ?? $('grid');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    els.chips.addEventListener('click', (event) => {
      const chip = event.target.closest('.chip');
      if (!chip) return;
      state.collection = chip.dataset.collection;
      state.tab = 'library';
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    els.sortSelect.addEventListener('change', () => {
      state.sort = els.sortSelect.value;
      storage.set(SORT_KEY, state.sort);
      renderAll();
    });

    els.searchToggle.addEventListener('click', () => {
      if (els.searchbar.hidden) openSearch();
      else closeSearch();
    });

    els.searchCancel.addEventListener('click', closeSearch);

    els.searchInput.addEventListener('input', debounce(() => {
      state.query = els.searchInput.value.trim();
      els.searchClear.hidden = !state.query;
      renderAll();
    }, 120));

    els.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSearch();
    });

    els.searchClear.addEventListener('click', () => {
      els.searchInput.value = '';
      state.query = '';
      els.searchClear.hidden = true;
      renderAll();
      els.searchInput.focus();
    });

    els.refreshBtn.addEventListener('click', async () => {
      els.refreshBtn.disabled = true;
      const label = els.refreshBtn.innerHTML;
      els.refreshBtn.innerHTML = '<span class="spinner sm"></span>Refreshing';
      await loadLibrary({ initial: true });
      els.refreshBtn.disabled = false;
      els.refreshBtn.innerHTML = label;
      if (!state.offline) toast('Library is up to date');
    });

    els.clearProgress.addEventListener('click', clearProgress);

    els.installBtn.addEventListener('click', async () => {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      try {
        await state.installPrompt.userChoice;
      } catch { /* ignore */ }
      state.installPrompt = null;
      renderSettings();
    });

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.installPrompt = event;
      renderSettings();
      if (state.tab === 'settings') toast('Trainu can be installed on this phone');
    });

    window.addEventListener('appinstalled', () => {
      state.installPrompt = null;
      toast('Trainu installed');
    });

    window.addEventListener('scroll', () => {
      els.topbar.classList.toggle('scrolled', window.scrollY > 6);
    }, { passive: true });

    window.addEventListener('online', () => loadLibrary({ quiet: true }));
    window.addEventListener('offline', () => {
      state.offline = true;
      renderConnection();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !state.player?.isOpen()) loadLibrary({ quiet: true });
    });

    window.addEventListener('popstate', () => {
      if (state.player?.isOpen()) state.player.close();
    });

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if (event.key === '/' && !typing && !state.player?.isOpen()) {
        event.preventDefault();
        openSearch();
      }
    });

    els.searchInput.addEventListener('search', () => {
      if (!els.searchInput.value) {
        state.query = '';
        els.searchClear.hidden = true;
        renderAll();
      }
    });
  }

  function registerServiceWorker() {
    const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!secure || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  async function init() {
    // Keep the pairing token out of the address bar and history.
    try {
      const url = new URL(location.href);
      if (url.searchParams.has('t')) {
        url.searchParams.delete('t');
        history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
    } catch { /* ignore */ }

    const savedSort = storage.get(SORT_KEY, 'recent');
    if (['recent', 'name', 'size', 'duration'].includes(savedSort)) state.sort = savedSort;
    els.sortSelect.value = state.sort;

    const cached = storage.get(CACHE_KEY, null);
    if (cached?.data) {
      state.library = cached.data;
      state.offline = true;
      state.loading = false;
      renderAll();
    }

    bindUI();
    renderConnection();
    registerServiceWorker();
    await loadLibrary({ initial: true });
    renderAll();

    // The manifest shortcut opens "/#continue"; honour it on cold starts.
    if (location.hash === '#continue') {
      state.tab = 'continue';
      renderAll();
    }

    setInterval(() => {
      if (!document.hidden && !state.player?.isOpen()) loadLibrary({ quiet: true });
    }, 30000);
  }

  init();
})();
