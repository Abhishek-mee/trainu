(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ICON = (name) => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

  function formatClock(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
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

  function readSetting(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeSetting(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }

  class TrainuPlayer {
    constructor({ onSave, onClose, cachePrefix = 'trainu' }) {
      this.onSave = onSave;
      this.onCloseCallback = onClose;
      this.cachePrefix = cachePrefix;

      this.root = $('player');
      this.video = $('p-video');
      this.title = $('p-title');
      this.subtitleLine = $('p-sub');
      this.seek = $('p-seek');
      this.timeLabel = $('p-time');
      this.durationLabel = $('p-duration');
      this.remainingLabel = $('p-remaining');
      this.notice = $('p-notice');
      this.noticeText = $('p-notice-text');
      this.noticeSpinner = $('p-notice-spinner');
      this.resumeToast = $('p-resume');
      this.resumeText = $('p-resume-text');
      this.startOverButton = $('p-startover');
      this.endCard = $('p-end');
      this.endTitle = $('p-end-title');
      this.endSub = $('p-end-sub');
      this.nextButton = $('p-next');
      this.endClose = $('p-end-close');
      this.errorPanel = $('p-error');
      this.errorTitle = $('p-error-title');
      this.errorText = $('p-error-text');
      this.errorRetry = $('p-error-retry');
      this.errorConvert = $('p-error-convert');
      this.errorClose = $('p-error-close');
      this.sheet = $('p-sheet');
      this.sheetBackdrop = $('p-sheet-backdrop');
      this.sheetContent = $('p-sheet-content');
      this.ccButton = $('p-cc');
      this.speedButton = $('p-speed');
      this.playButton = $('p-play');
      this.bigPlay = $('p-bigplay');
      this.fullButton = $('p-full');
      this.pipButton = $('p-pip');
      this.muteButton = $('p-mute');
      this.flashLeft = $('p-flash-left');
      this.flashRight = $('p-flash-right');

      this.openState = false;
      this.item = null;
      this.queue = [];
      this.canConvert = false;
      this.mode = 'direct';
      this.startOffset = 0;
      this.estimatedDuration = 0;
      this.pendingResume = 0;
      this.pendingAutoplay = false;
      this.triedConvert = false;
      this.scrubbing = false;
      this.scrubTarget = 0;
      this.sheetIsOpen = false;
      this.trackElements = [];
      this.previousOverflow = '';
      this.lastTap = 0;
      this.lastTapX = 0;
      this.tapTimer = null;
      this.resumeTimer = null;
      this.flashTimer = null;
      this.hideTimer = null;
      this.saveTimer = null;
      this.uiTimer = null;
      this.wakeLock = null;
      this.lastSavedAt = 0;
      this.ended = false;

      this.speed = Number(readSetting(`${cachePrefix}:speed`, 1));
      if (!Number.isFinite(this.speed) || this.speed < 0.25 || this.speed > 3) this.speed = 1;

      this._bind();
      this._updateSpeedLabel();
      this._updateMuteIcon();
    }

    isOpen() {
      return this.openState;
    }

    /* ---------------------------------------------------------------- */
    /* Open / close                                                      */
    /* ---------------------------------------------------------------- */

    open({ item, queue = [], canConvert = false, thumbUrl = null }) {
      const wasOpen = this.openState;
      this.item = item;
      this.queue = Array.isArray(queue) && queue.length ? queue : [item];
      this.canConvert = Boolean(canConvert);
      this.thumbUrl = thumbUrl;
      this.triedConvert = false;
      this.ended = false;
      this.scrubbing = false;
      this.estimatedDuration = 0;
      this.pendingResume = 0;
      this._hideEnd();
      this._hideError();
      this._hideResume();
      this._clearTracks();
      this._setupTracks();

      if (!wasOpen) this.previousOverflow = document.body.style.overflow;
      this.openState = true;
      this.root.hidden = false;
      this.root.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      document.title = `${item.title} · Trainu`;

      this.title.textContent = item.title;
      const meta = [item.collection, item.height ? `${item.width ?? '?'}×${item.height}` : '', formatBytes(item.size)]
        .filter(Boolean)
        .join(' · ');
      this.subtitleLine.textContent = meta;

      this.video.playbackRate = this.speed;
      this._updateSpeedLabel();
      this.pipButton.hidden = !(document.pictureInPictureEnabled && this.video.requestPictureInPicture);
      this.ccButton.hidden = !item.subtitles?.length;

      const progress = item.progress;
      const canResume = progress && !progress.finished && progress.pos > 5
        && (!progress.dur || progress.pos < progress.dur - 10);
      const resumeAt = canResume ? progress.pos : 0;

      const needsConvert = item.direct === false;
      if (needsConvert && this.canConvert) {
        this.mode = 'convert';
        this.startOffset = resumeAt;
        this.triedConvert = true;
        this._showNotice('Converting on the laptop…', true);
        this._loadSource({ autoplay: true });
        if (resumeAt > 5) this._showResume(resumeAt, true);
      } else {
        this.mode = 'direct';
        this.startOffset = 0;
        this.pendingResume = resumeAt;
        this._loadSource({ autoplay: true });
        if (needsConvert && !this.canConvert) {
          this._showNotice(item.directReason === 'container'
            ? 'This container may not play in a browser'
            : 'Trying the original codec', false);
        } else {
          this._hideNotice();
        }
      }

      this.showControls();
      this._updateUI();
      this._updatePlayState();
      this._startTimers();
      this._applySubtitle(this._preferredSubtitleIndex());
      this._setMediaSession();
      try { this.root.focus({ preventScroll: true }); } catch { /* ignore */ }
      if (this.video.paused) this.pendingAutoplay = true;
    }

    close() {
      if (!this.openState) return;
      this.openState = false;
      this._save(true);
      this._stopTimers();
      this._releaseWakeLock();
      clearTimeout(this.resumeTimer);
      clearTimeout(this.flashTimer);
      this._hideResume();
      this._hideEnd();
      this._hideError();
      this._closeSheet();
      this.video.pause();
      this.video.removeAttribute('src');
      try { this.video.load(); } catch { /* ignore */ }
      this.root.hidden = true;
      this.root.setAttribute('aria-hidden', 'true');
      this.root.classList.remove('playing', 'loading', 'idle');
      document.body.style.overflow = this.previousOverflow;
      document.title = 'Trainu';
      this._clearTracks();
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = null;
          navigator.mediaSession.playbackState = 'none';
        } catch { /* ignore */ }
      }
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      this.onCloseCallback?.();
    }

    /* ---------------------------------------------------------------- */
    /* Sources                                                           */
    /* ---------------------------------------------------------------- */

    _loadSource({ autoplay }) {
      this.pendingAutoplay = Boolean(autoplay);
      this.ended = false;
      this._hideEnd();
      this.video.pause();
      if (this.mode === 'convert') {
        const start = Math.max(0, this.startOffset);
        this.video.src = `/api/convert/${this.item.id}?start=${start.toFixed(2)}&v=${Date.now()}`;
        this.seek.disabled = !this.currentDuration();
      } else {
        this.video.src = `/media/${this.item.id}`;
        this.seek.disabled = false;
      }
      this.root.classList.add('loading');
      try { this.video.load(); } catch { /* ignore */ }
      if (autoplay) this._tryPlay();
      this._updateUI();
    }

    _retry() {
      this._hideError();
      if (this.mode === 'convert') {
        this.startOffset = this._position();
        this._showNotice('Reconnecting the stream…', true);
        this._loadSource({ autoplay: true });
      } else {
        this._loadSource({ autoplay: true });
      }
    }

    _startConvertAt(target) {
      if (!this.canConvert) return;
      this.mode = 'convert';
      this.startOffset = Math.max(0, target);
      this.triedConvert = true;
      this._showNotice(`Converting from ${formatClock(target)}…`, true);
      this._loadSource({ autoplay: true });
    }

    _tryPlay() {
      const promise = this.video.play();
      if (promise?.catch) {
        promise.catch(() => {
          this.pendingAutoplay = false;
          this._updatePlayState();
          this.showControls();
        });
      }
    }

    /* ---------------------------------------------------------------- */
    /* Progress                                                          */
    /* ---------------------------------------------------------------- */

    _position() {
      const base = this.mode === 'convert' ? this.startOffset : 0;
      const current = Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0;
      const total = this._duration();
      const position = base + current;
      return total > 0 ? Math.min(position, total) : Math.max(0, position);
    }

    _duration() {
      if (Number.isFinite(this.item?.duration) && this.item.duration > 0) return this.item.duration;
      if (this.estimatedDuration > 0) return this.estimatedDuration;
      const mediaDuration = Number(this.video.duration);
      if (Number.isFinite(mediaDuration) && mediaDuration > 0) {
        return this.mode === 'convert' ? this.startOffset + mediaDuration : mediaDuration;
      }
      return 0;
    }

    _save(final) {
      if (!this.item) return;
      const now = Date.now();
      if (!final && now - this.lastSavedAt < 4000) return;
      const duration = this._duration();
      let position = this._position();
      if (!Number.isFinite(position) || position < 0.5) return;
      if (duration > 0) position = Math.min(position, duration);
      const finished = Boolean(final && duration > 0 && position >= duration - 2);
      this.lastSavedAt = now;
      this.onSave?.(this.item, position, duration, finished);
    }

    /* ---------------------------------------------------------------- */
    /* UI                                                                */
    /* ---------------------------------------------------------------- */

    showControls() {
      this.root.classList.remove('idle');
      clearTimeout(this.hideTimer);
      if (!this.video.paused && !this.sheetIsOpen && !this.ended) {
        this.hideTimer = setTimeout(() => {
          if (!this.sheetIsOpen) this.root.classList.add('idle');
        }, 4200);
      }
    }

    toggleControls() {
      if (this.sheetIsOpen) return;
      if (this.root.classList.contains('idle')) this.showControls();
      else {
        this.root.classList.add('idle');
        this._closeSheet();
      }
    }

    togglePlay() {
      if (!this.item) return;
      if (this.video.paused) {
        this._hideEnd();
        this._tryPlay();
      } else {
        this.video.pause();
      }
    }

    seekBy(delta, side) {
      const duration = this._duration();
      let target = this._position() + delta;
      target = Math.max(0, duration > 0 ? Math.min(target, duration - 0.4) : target);
      if (this.mode === 'convert') {
        this._startConvertAt(target);
      } else {
        try { this.video.currentTime = target; } catch { /* ignore */ }
      }
      this._flashSeek(side, delta, target);
      this.showControls();
      this._updateUI();
    }

    _commitSeek(target) {
      const duration = this._duration();
      let next = Math.max(0, Number(target) || 0);
      if (duration > 0) next = Math.min(next, duration - 0.3);
      if (this.mode === 'convert') {
        this._startConvertAt(next);
      } else {
        try { this.video.currentTime = next; } catch { /* ignore */ }
        if (this.video.paused) this._tryPlay();
      }
      this._updateUI();
    }

    _flashSeek(side, delta, target) {
      const element = side === 'left' ? this.flashLeft : this.flashRight;
      element.innerHTML = `${delta > 0 ? '+' : '−'}10s<span>${formatClock(target)}</span>`;
      element.classList.add('show');
      clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => element.classList.remove('show'), 700);
    }

    _showResume(seconds, converted = false) {
      this.resumeText.textContent = `${converted ? 'Converted from' : 'Resuming from'} ${formatClock(seconds)}`;
      this.resumeToast.hidden = false;
      clearTimeout(this.resumeTimer);
      this.resumeTimer = setTimeout(() => { this.resumeToast.hidden = true; }, 8000);
    }

    _hideResume() {
      this.resumeToast.hidden = true;
      clearTimeout(this.resumeTimer);
    }

    _showNotice(text, spinning) {
      this.notice.hidden = false;
      this.noticeText.textContent = text;
      this.noticeSpinner.hidden = !spinning;
    }

    _hideNotice() {
      this.notice.hidden = true;
    }

    _updateUI() {
      if (!this.item) return;
      const duration = this._duration();
      const position = this.scrubbing ? this.scrubTarget : this._position();
      const percent = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;

      let bufferEnd = 0;
      const buffered = this.video.buffered;
      for (let index = 0; index < buffered.length; index += 1) {
        bufferEnd = Math.max(bufferEnd, buffered.end(index));
      }
      if (this.mode === 'convert') bufferEnd += this.startOffset;
      const bufferPercent = duration > 0 ? Math.min(100, Math.max(percent, (bufferEnd / duration) * 100)) : percent;

      if (!this.scrubbing) {
        this.seek.value = String(Math.round(percent * 10));
      }
      this.seek.style.setProperty('--fill', `${percent}%`);
      this.seek.style.setProperty('--buffer', `${bufferPercent}%`);
      this.timeLabel.textContent = formatClock(position);
      this.durationLabel.textContent = duration > 0 ? formatClock(duration) : '';
      this.remainingLabel.textContent = duration > 0 ? `−${formatClock(Math.max(0, duration - position))}` : '';
      this.seek.disabled = !(duration > 0);

      if ('mediaSession' in navigator && duration > 0 && Number.isFinite(position)) {
        try {
          navigator.mediaSession.setPositionState({
            duration,
            playbackRate: this.video.playbackRate || 1,
            position: Math.min(Math.max(0, position), duration),
          });
        } catch { /* ignore */ }
      }
    }

    _updatePlayState() {
      const paused = this.video.paused || this.video.ended;
      this.root.classList.toggle('playing', !paused);
      this.playButton.innerHTML = ICON(paused ? 'play' : 'pause');
      this.bigPlay.innerHTML = ICON('play');
      this.playButton.setAttribute('aria-label', paused ? 'Play' : 'Pause');
      this.bigPlay.setAttribute('aria-label', paused ? 'Play' : 'Pause');
      this.root.classList.toggle('loading', false);
      if (paused) {
        this.showControls();
        clearTimeout(this.hideTimer);
        this._releaseWakeLock();
      } else {
        this.showControls();
        this._requestWakeLock();
      }
      if ('mediaSession' in navigator) {
        try { navigator.mediaSession.playbackState = paused ? 'paused' : 'playing'; } catch { /* ignore */ }
      }
      this._updateMuteIcon();
    }

    _updateMuteIcon() {
      const muted = this.video.muted || this.video.volume === 0;
      this.muteButton.innerHTML = ICON(muted ? 'muted' : 'volume');
      this.muteButton.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    }

    _updateSpeedLabel() {
      this.speedButton.textContent = `${this.speed}×`;
    }

    _updateFullscreenIcon() {
      const active = Boolean(document.fullscreenElement);
      this.fullButton.innerHTML = ICON(active ? 'fullscreen-exit' : 'fullscreen');
      this.fullButton.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Fullscreen');
    }

    /* ---------------------------------------------------------------- */
    /* Error / end                                                       */
    /* ---------------------------------------------------------------- */

    _handleError() {
      if (!this.openState) return;
      this.root.classList.remove('loading');
      const code = this.video.error?.code;
      this._hideNotice();

      if (this.mode === 'direct' && !this.triedConvert && this.canConvert && this.item.direct !== true) {
        this.triedConvert = true;
        this._startConvertAt(this._position());
        return;
      }

      let title = 'Can\'t play this video';
      let message = 'The stream stopped unexpectedly. Reconnect the cable or Wi-Fi and try again.';
      if (code === 2) {
        message = 'The link to the laptop dropped. Check the USB cable or Wi-Fi and press retry.';
      } else if (code === 4) {
        if (!this.canConvert && this.item.direct === false) {
          title = 'This format needs ffmpeg';
          message = 'Install ffmpeg on the laptop to play MKV, AVI or HEVC files. Trainu can still play MP4 and WebM without it.';
        } else if (this.mode === 'convert') {
          title = 'The laptop could not convert this';
          message = 'Check that ffmpeg is installed and the file plays on the laptop. You can also try the original file.';
        } else {
          message = 'The browser cannot decode this file. If ffmpeg is installed on the laptop, try converting it.';
        }
      } else if (this.mode === 'convert') {
        title = 'Conversion stopped';
        message = 'The laptop stopped converting. Check the phone connection and try again.';
      }
      this._showError(title, message, {
        canConvert: this.canConvert && this.mode === 'direct',
        retry: true,
      });
    }

    _showError(title, message, { canConvert = false, retry = true } = {}) {
      this.errorTitle.textContent = title;
      this.errorText.textContent = message;
      this.errorConvert.hidden = !canConvert;
      this.errorRetry.hidden = !retry;
      this.errorPanel.hidden = false;
      this.root.classList.remove('idle');
      this._releaseWakeLock();
    }

    _hideError() {
      this.errorPanel.hidden = true;
    }

    _showEnd() {
      this.ended = true;
      const index = this.queue.findIndex((entry) => entry.id === this.item.id);
      const next = index >= 0 ? this.queue[index + 1] : null;
      this.endTitle.textContent = next ? next.title : this.item.title;
      this.endSub.textContent = next
        ? 'Up next from the same list.'
        : 'That was the last video in this list.';
      this.nextButton.hidden = !next;
      this.endCard.hidden = false;
      this.root.classList.add('idle');
      this._releaseWakeLock();
      this._save(true);
    }

    _hideEnd() {
      this.endCard.hidden = true;
      this.ended = false;
    }

    _playNext() {
      const index = this.queue.findIndex((entry) => entry.id === this.item.id);
      const next = index >= 0 ? this.queue[index + 1] : null;
      if (!next) return;
      this._save(true);
      this.open({
        item: next,
        queue: this.queue,
        canConvert: this.canConvert,
        thumbUrl: next.thumb ? `/api/thumbnails/${next.id}.jpg` : null,
      });
    }

    /* ---------------------------------------------------------------- */
    /* Subtitles                                                         */
    /* ---------------------------------------------------------------- */

    _clearTracks() {
      for (const track of this.trackElements) track.remove();
      this.trackElements = [];
      this.selectedSubtitle = -1;
    }

    _setupTracks() {
      this._clearTracks();
      const subtitles = this.item?.subtitles ?? [];
      this.ccButton.hidden = !subtitles.length;
      if (!subtitles.length) return;
      subtitles.forEach((subtitle, index) => {
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = subtitle.label || `Track ${index + 1}`;
        track.srclang = (subtitle.lang || 'und').slice(0, 8);
        track.src = `/api/subtitle/${this.item.id}/${index}.vtt`;
        track.dataset.index = String(index);
        this.video.appendChild(track);
        this.trackElements.push(track);
      });
    }

    _preferredSubtitleIndex() {
      if (!this.trackElements.length) return -1;
      const on = readSetting(`${this.cachePrefix}:subs`, false);
      return on ? 0 : -1;
    }

    _applySubtitle(index) {
      this.selectedSubtitle = index;
      for (let position = 0; position < this.trackElements.length; position += 1) {
        const track = this.trackElements[position];
        if (track.track) track.track.mode = position === index ? 'showing' : 'disabled';
      }
      this.ccButton.classList.toggle('active', index >= 0);
      writeSetting(`${this.cachePrefix}:subs`, index >= 0);
      this._closeSheet();
      this.showControls();
    }

    /* ---------------------------------------------------------------- */
    /* Sheet                                                             */
    /* ---------------------------------------------------------------- */

    _openSheet() {
      if (!this.item) return;
      this._renderSheet();
      this.sheetIsOpen = true;
      this.sheetBackdrop.classList.add('show');
      this.sheet.classList.add('show');
      this.root.classList.remove('idle');
      clearTimeout(this.hideTimer);
    }

    _closeSheet() {
      this.sheetIsOpen = false;
      this.sheetBackdrop.classList.remove('show');
      this.sheet.classList.remove('show');
      this.showControls();
    }

    _renderSheet() {
      const content = document.createDocumentFragment();
      const header = (text) => {
        const element = document.createElement('h4');
        element.textContent = text;
        content.appendChild(element);
      };
      const option = (label, selected, onClick, hint = '') => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sheet-option';
        const left = document.createElement('span');
        left.textContent = label;
        button.appendChild(left);
        if (selected) {
          const check = document.createElement('span');
          check.className = 'check';
          check.textContent = '✓';
          button.appendChild(check);
        } else if (hint) {
          const small = document.createElement('span');
          small.className = 'muted';
          small.textContent = hint;
          button.appendChild(small);
        }
        button.addEventListener('click', onClick);
        content.appendChild(button);
      };

      header('Playback speed');
      for (const speed of SPEEDS) {
        option(`${speed}×`, Math.abs(this.speed - speed) < 0.01, () => {
          this.speed = speed;
          this.video.playbackRate = speed;
          writeSetting(`${this.cachePrefix}:speed`, speed);
          this._updateSpeedLabel();
          this._renderSheet();
        });
      }

      if (this.trackElements.length) {
        header('Subtitles');
        option('Off', this.selectedSubtitle < 0, () => this._applySubtitle(-1));
        (this.item.subtitles ?? []).forEach((subtitle, index) => {
          option(subtitle.label || `Track ${index + 1}`, this.selectedSubtitle === index, () => this._applySubtitle(index));
        });
      }

      header('This video');
      const info = document.createElement('div');
      info.className = 'rows';
      const row = (label, value) => {
        if (!value) return;
        const element = document.createElement('div');
        element.className = 'row';
        const key = document.createElement('span');
        key.textContent = label;
        const val = document.createElement('b');
        val.textContent = value;
        element.append(key, val);
        info.appendChild(element);
      };
      row('Format', [this.item.ext?.replace('.', '').toUpperCase(), this.item.vcodec, this.item.acodec].filter(Boolean).join(' · '));
      row('Resolution', this.item.width && this.item.height ? `${this.item.width}×${this.item.height}` : '');
      row('Size', formatBytes(this.item.size));
      row('Folder', this.item.collection);
      row('Playing', this.mode === 'convert' ? 'Live conversion' : 'Original file');
      content.appendChild(info);

      if (this.item.directReason !== 'container') {
        if (this.mode === 'convert') {
          option('Try the original file', false, () => {
            this.mode = 'direct';
            this.startOffset = 0;
            this.estimatedDuration = 0;
            this._hideNotice();
            this._loadSource({ autoplay: true });
            this._closeSheet();
          });
        } else if (this.canConvert) {
          option('Convert on the laptop', false, () => {
            this._startConvertAt(this._position());
            this._closeSheet();
          });
        }
      }

      option('Close player', false, () => this.close());

      this.sheetContent.replaceChildren(content);
    }

    /* ---------------------------------------------------------------- */
    /* Media session / wake lock / fullscreen                            */
    /* ---------------------------------------------------------------- */

    _setMediaSession() {
      if (!('mediaSession' in navigator) || !this.item) return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: this.item.title,
          artist: this.item.collection || 'Trainu',
          album: 'Trainu',
          artwork: [
            { src: `${location.origin}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
            { src: `${location.origin}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          ],
        });
      } catch { /* ignore */ }
    }

    async _requestWakeLock() {
      if (this.wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
      } catch { /* ignore */ }
    }

    _releaseWakeLock() {
      if (this.wakeLock) {
        this.wakeLock.release().catch(() => {});
        this.wakeLock = null;
      }
    }

    async _toggleFullscreen() {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
        return;
      }
      if (this.root.requestFullscreen) {
        try {
          await this.root.requestFullscreen({ navigationUI: 'hide' });
          try { await screen.orientation?.lock?.('landscape'); } catch { /* ignore */ }
        } catch { /* ignore */ }
        return;
      }
      if (this.video.webkitEnterFullscreen) {
        try { this.video.webkitEnterFullscreen(); } catch { /* ignore */ }
      }
    }

    async _togglePip() {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await this.video.requestPictureInPicture();
      } catch {
        // Some browsers reject PiP for this video; there is nothing to do.
      }
    }

    /* ---------------------------------------------------------------- */
    /* Timers / events                                                   */
    /* ---------------------------------------------------------------- */

    _startTimers() {
      this._stopTimers();
      this.saveTimer = setInterval(() => this._save(false), 5000);
      this.uiTimer = setInterval(() => this._updateUI(), 250);
    }

    _stopTimers() {
      clearInterval(this.saveTimer);
      clearInterval(this.uiTimer);
      this.saveTimer = null;
      this.uiTimer = null;
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    _bind() {
      const video = this.video;

      video.addEventListener('loadedmetadata', () => {
        if (this.mode === 'convert') {
          const mediaDuration = Number(video.duration);
          if (Number.isFinite(mediaDuration) && mediaDuration > 0) {
            this.estimatedDuration = this.startOffset + mediaDuration;
          }
        }
        if (this.mode === 'direct' && this.pendingResume > 5) {
          const duration = this._duration();
          if (!duration || this.pendingResume < duration - 5) {
            try { video.currentTime = this.pendingResume; } catch { /* ignore */ }
            this._showResume(this.pendingResume);
          }
        }
        this.pendingResume = 0;
        this.root.classList.remove('loading');
        this._updateUI();
      });

      video.addEventListener('durationchange', () => {
        this.root.classList.remove('loading');
        this._updateUI();
      });

      video.addEventListener('timeupdate', () => {
        if (!this.scrubbing) this._updateUI();
        this._save(false);
      });

      video.addEventListener('progress', () => this._updateUI());
      video.addEventListener('loadstart', () => this.root.classList.add('loading'));
      video.addEventListener('canplay', () => {
        this.root.classList.remove('loading');
        if (this.pendingAutoplay && video.paused && !this.ended) {
          this.pendingAutoplay = false;
          this._tryPlay();
        }
      });
      video.addEventListener('playing', () => {
        this.root.classList.remove('loading');
        if (this.mode === 'convert') this._showNotice('Live conversion', false);
        this._updatePlayState();
        this.pendingAutoplay = false;
      });
      video.addEventListener('play', () => this._updatePlayState());
      video.addEventListener('pause', () => {
        this._updatePlayState();
        this._save(true);
      });
      video.addEventListener('waiting', () => {
        this.root.classList.add('loading');
        this.showControls();
      });
      video.addEventListener('stalled', () => this.root.classList.add('loading'));
      video.addEventListener('ended', () => this._showEnd());
      video.addEventListener('error', () => this._handleError());
      video.addEventListener('volumechange', () => this._updateMuteIcon());
      video.addEventListener('ratechange', () => { this.speed = video.playbackRate; this._updateSpeedLabel(); });
      video.addEventListener('enterpictureinpicture', () => this.pipButton.classList.add('active'));
      video.addEventListener('leavepictureinpicture', () => this.pipButton.classList.remove('active'));

      video.addEventListener('click', (event) => {
        if (!this.openState) return;
        const now = performance.now();
        if (now - this.lastTap < 320 && Math.abs(event.clientX - this.lastTapX) < 70) {
          clearTimeout(this.tapTimer);
          this.lastTap = 0;
          const rect = video.getBoundingClientRect();
          const side = event.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
          this.seekBy(side === 'left' ? -10 : 10, side);
          return;
        }
        this.lastTap = now;
        this.lastTapX = event.clientX;
        clearTimeout(this.tapTimer);
        this.tapTimer = setTimeout(() => {
          this.toggleControls();
          this.lastTap = 0;
        }, 220);
      });

      $('p-close').addEventListener('click', () => this.close());
      $('p-menu-btn').addEventListener('click', () => {
        if (this.sheetIsOpen) this._closeSheet();
        else this._openSheet();
      });
      this.bigPlay.addEventListener('click', () => this.togglePlay());
      this.playButton.addEventListener('click', () => this.togglePlay());
      $('p-back').addEventListener('click', () => this.seekBy(-10, 'left'));
      $('p-fwd').addEventListener('click', () => this.seekBy(10, 'right'));
      this.muteButton.addEventListener('click', () => {
        this.video.muted = !this.video.muted;
        this._updateMuteIcon();
      });
      this.ccButton.addEventListener('click', () => {
        if (!this.trackElements.length) return;
        const next = this.selectedSubtitle >= 0 ? -1 : 0;
        this._applySubtitle(next);
        this.showControls();
      });
      this.speedButton.addEventListener('click', () => this._openSheet());
      this.pipButton.addEventListener('click', () => this._togglePip());
      this.fullButton.addEventListener('click', () => this._toggleFullscreen());

      this.seek.addEventListener('input', () => {
        const duration = this._duration();
        if (!duration) return;
        const target = (Number(this.seek.value) / 1000) * duration;
        this.scrubbing = true;
        this.scrubTarget = target;
        this.seek.style.setProperty('--fill', `${Number(this.seek.value) / 10}%`);
        this.timeLabel.textContent = formatClock(target);
        this.remainingLabel.textContent = `−${formatClock(Math.max(0, duration - target))}`;
      });
      this.seek.addEventListener('change', () => {
        const duration = this._duration();
        if (!duration) { this.scrubbing = false; return; }
        const target = (Number(this.seek.value) / 1000) * duration;
        this.scrubbing = false;
        this._commitSeek(target);
        this.showControls();
      });

      this.startOverButton.addEventListener('click', () => {
        this._hideResume();
        if (this.mode === 'convert') this._startConvertAt(0);
        else {
          try { this.video.currentTime = 0; } catch { /* ignore */ }
          this._tryPlay();
        }
        this.showControls();
      });

      this.endClose.addEventListener('click', () => this.close());
      this.nextButton.addEventListener('click', () => this._playNext());
      this.errorRetry.addEventListener('click', () => this._retry());
      this.errorClose.addEventListener('click', () => this.close());
      this.errorConvert.addEventListener('click', () => {
        this._hideError();
        this._startConvertAt(this._position());
      });

      this.sheetBackdrop.addEventListener('click', () => this._closeSheet());

      this.root.addEventListener('pointermove', () => {
        if (!this.sheetIsOpen) this.showControls();
      }, { passive: true });
      this.root.addEventListener('pointerdown', () => {
        if (!this.sheetIsOpen) this.showControls();
      }, { passive: true });

      document.addEventListener('fullscreenchange', () => this._updateFullscreenIcon());
      if (video.webkitEnterFullscreen) {
        video.addEventListener('webkitendfullscreen', () => this._updateFullscreenIcon());
      }

      document.addEventListener('keydown', (event) => {
        if (!this.openState) return;
        const target = event.target;
        const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
        if (typing && target !== this.seek) return;
        if (event.key === 'Escape') {
          if (this.sheetIsOpen) this._closeSheet();
          else this.close();
          return;
        }
        if (this.sheetIsOpen) return;
        switch (event.key) {
          case ' ':
          case 'k':
            event.preventDefault();
            this.togglePlay();
            break;
          case 'ArrowLeft':
            event.preventDefault();
            this.seekBy(-10, 'left');
            break;
          case 'ArrowRight':
            event.preventDefault();
            this.seekBy(10, 'right');
            break;
          case 'ArrowUp':
            event.preventDefault();
            this.video.volume = Math.min(1, this.video.volume + 0.1);
            break;
          case 'ArrowDown':
            event.preventDefault();
            this.video.volume = Math.max(0, this.video.volume - 0.1);
            break;
          case 'm':
            this.video.muted = !this.video.muted;
            break;
          case 'f':
            this._toggleFullscreen();
            break;
          case 'c':
            if (this.trackElements.length) this._applySubtitle(this.selectedSubtitle >= 0 ? -1 : 0);
            break;
          default:
            break;
        }
      });

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this._save(true);
        } else if (this.openState && !this.video.paused) {
          this._requestWakeLock();
        }
      });

      window.addEventListener('pagehide', () => {
        if (this.openState) this._save(true);
      });

      this._updateFullscreenIcon();
    }
  }

  window.TrainuPlayer = TrainuPlayer;
})();
