# Changelog

All notable changes to Trainu are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-25

The first public release. Trainu is a zero-dependency Node.js app that streams a laptop's video folders to a phone over USB or local Wi-Fi.

### Added

- Recursive library scanning for MP4, M4V, MOV, WebM, OGV, MKV, AVI, WMV, FLV, TS, M2TS, MPG, 3GP, ASF and VOB.
- Installable phone PWA with a cinematic billboard, two-column library, search, folder filters, continue-watching rail, settings and a custom player.
- HTTP Range/206 and HEAD streaming, so the player can seek without copying the file.
- Direct play for browser-supported codecs and live fragmented-MP4 conversion for unsupported files through ffmpeg.
- Poster thumbnails, ffprobe metadata and remuxing when ffmpeg is available.
- SRT/VTT sidecar subtitles, converted to WebVTT on the fly, with a language label.
- Per-device resume positions stored on the laptop.
- One-click USB debugging flow: auto-detects adb in the project, PATH and Android SDK folders; restarts adb when authorization is stale; waits for the Android RSA prompt; runs `adb reverse` for the phone port only.
- USB tethering and Wi-Fi connection paths, with QR codes for each address.
- Separate loopback-only laptop panel with library, engine and activity views.
- Pairing pass page with an eight-character code and `HttpOnly`, `SameSite=Lax` cookies.
- Privacy boundaries: hashed media IDs, no filesystem paths in phone JSON, no directory listing, no admin access from the phone listener.
- 24 automated tests covering ranges, auth, pairing, admin isolation, progress, subtitles, gzip, static assets, path traversal, adb parsing and the prompt-wait state machine.
- CI for Node.js 20, 22 and 24 on Linux and Windows.
- Public documentation: README, design notes, contribution guide, security policy, code of conduct and issue/PR templates.

### Security

- The admin listener binds to `127.0.0.1` on an ephemeral port and is never forwarded by `adb reverse`.
- Remote clients that ask the main listener for admin routes receive 403.
- Unpaired clients receive 401/403 for APIs and media.
- Media URLs are limited to indexed videos and their sidecars.

### Known limitations

- The LAN link is plain HTTP. Use USB debugging/localhost for the strongest isolation, and only on a network you trust.
- iOS does not expose a usable USB network to third-party apps; use Wi-Fi on iPhone and iPad.
- Live conversion is CPU-bound and limited to two concurrent jobs.
- The real Android authorization prompt cannot be automated; the state machine is covered with a fake adb runner, and the physical flow is documented for manual testing.
