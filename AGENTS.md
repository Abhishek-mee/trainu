# AGENTS.md

## Project

Trainu is a zero-dependency Node.js 20+ app that streams videos from laptop folders to a phone over USB or local Wi-Fi. The phone client is a vanilla-JS PWA; the laptop control panel is served by a separate loopback-only listener. There is no bundler, transpiler, framework, lockfile, linter or type checker.

## Verified commands

```powershell
npm start                                   # start server, opens the laptop panel
npm test                                    # all tests (24 pass)
node --test test/server.test.mjs            # server integration tests only (15)
node --test --test-name-pattern="watch progress" test/server.test.mjs
npm run icons                               # regenerate public/icons/*.png
node scripts/make-signal-figure.mjs         # regenerate public/iso-local-link.svg
node bin/trainu.mjs --help
```

Do not run `npm install`; there are no dependencies. Do not add one without a clear need and user approval. Do not document build/lint/typecheck commands because none exist.

## Architecture

- `bin/trainu.mjs` — CLI parsing, startup banner, graceful shutdown; prints and opens `server.adminUrl`.
- `src/server.mjs` — routing, pairing/auth, two listeners (main phone server + loopback-only admin), range streaming, progress endpoints. The pair page receives `<!--PANEL_URL-->` substituted with `127.0.0.1:<adminPort>/desktop`.
- `src/library.mjs` — recursive scan, direct-play detection, SRT/VTT sidecar discovery, metadata application.
- `src/media.mjs` — ffmpeg/ffprobe discovery (config, env, `tools/ffmpeg`, PATH), thumbnails, range parser, live conversion.
- `src/config.mjs` — `.trainu/config.json`, folders, token, settings.
- `src/progress.mjs` — per-device positions in `.trainu/progress.json`.
- `src/usb.mjs` — adb discovery/reverse, network address detection, firewall command.
- `public/` — phone UI, desktop panel, pair page, service worker, manifest, icons, `iso-local-link.svg`.
- `scripts/` — icon generator, isometric projection kit (`iso-figure-kit.mjs`) and figure composition (`make-signal-figure.mjs`).
- `test/` — node:test integration tests using real servers and temp libraries.

## Conventions and invariants

- ES modules on the server; browser scripts are dependency-free IIFEs.
- Keep the app dependency-free and offline-first. No CDN or external asset URLs.
- Never return filesystem paths in phone-facing JSON. Media is addressed by the 16-char hashed ID. Only indexed videos and sidecars have requestable URLs.
- Admin UI and `/api/admin/*` must stay on the separate listener bound to `127.0.0.1` with an ephemeral port. The main listener may 307 loopback browsers to `adminUrl` but must return 403 to remote clients. `adb reverse` forwards only the main port; never forward the admin port.
- Pairing uses the random token from config; cookies are HttpOnly/SameSite=Lax. The pair page must show `127.0.0.1:<adminPort>/desktop`, not the main port's `/desktop`.
- Streaming must keep HTTP Range/206 and HEAD support; the player depends on it. Streaming indexed bytes is intentional; there is no file copying and no arbitrary filesystem access.
- Update tests when changing routes, auth, progress or scanning behavior.
- `.trainu/`, `node_modules/`, `tools/ffmpeg/` and `tools/platform-tools/` are ignored. Runtime data and downloaded binaries must not be committed.
- `ffmpeg`, `ffprobe` and `adb` are optional. This machine has ffmpeg 9.0.2 with ffprobe under `tools/ffmpeg/bin/` (auto-detected, not on `PATH`); live transcode and poster generation were verified against it. Platform-tools now sits at `tools/platform-tools/adb.exe` (auto-detected, not on `PATH`); the physical POCO phone was verified authorized and `adb reverse tcp:8765` was exercised. Do not claim an untested codec, device or OS path works.
- USB documentation must preserve these facts: adb reverse over `localhost`, Android USB tethering as a no-adb option, Wi-Fi fallback, and the iOS USB limitation (use Wi-Fi). The panel's one-click flow must restart adb when a phone is unauthorized, wait for the Android RSA prompt, and explain File transfer mode, Revoke USB debugging authorizations, cable/port checks and Xiaomi/HyperOS behavior when no prompt appears.
- Design direction: the phone is Netflix-inspired (pure black, `#e50914` red, white/grey Helvetica-style type, cinematic billboard, red progress). The laptop panel stays Runway-inspired monochrome (black, white, cool grey, mono labels); do not apply the phone theme to the panel. Trainu branding stays; never use Netflix logos, wordmarks or assets. The laptop panel's hero uses the generated isometric "screening desk" (`public/iso-local-link.svg`); keep figure edits in `scripts/make-signal-figure.mjs` and regenerate rather than hand-editing the SVG.
- Phone poster fallbacks use neutral black/grey gradients, not warm hues. Keep the phone UI free of links that imply the phone can open the admin panel.

## Manual checks

After server/UI changes, start on a free port with a throwaway data folder:

```powershell
node bin/trainu.mjs --port 0 --data "$env:TEMP\trainu-dev" --no-open
```

Open the **printed admin URL** (not the main port's `/desktop`), pair, and exercise the player. Also check:

- `/api/library` contains no `filePath`;
- the admin port refuses non-loopback clients and is not forwarded by `adb reverse`;
- unpaired remote requests get 401/403;
- the pair page shows the admin port and no placeholder text;
- an MKV plays through `/api/convert/<id>` with `X-Trainu-Mode: transcode`, and `/api/thumbnails/<id>.jpg` returns a JPEG;
- **Connect phone** in the USB debugging tab shows the device model and **USB link active**, and `adb reverse --list` contains `tcp:8765`;
- an unauthorized phone shows the waiting state, then finishes automatically after **Allow** is tapped;
- **Phone prompt not showing?** is visible and the panel explains File transfer, revoke, cable and HyperOS steps;
- phone views at 393×851, 360×800 and 320×800 have no horizontal overflow, and the panel holds together at 1120, 860 and 660 px.
