# Security policy

Trainu is a local-first app. The laptop is the trust boundary, and the phone is a paired client on a cable or a trusted local network. This page explains what is in scope and how to report a problem.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| Earlier | No |

Security fixes land on the latest 1.x release.

## Reporting a vulnerability

Please **do not** open a public issue with exploit details.

Use GitHub's private vulnerability reporting:

1. Open <https://github.com/Abhishek-mee/trainu/security/advisories/new>.
2. Describe the issue, the affected version, and the smallest reproduction you can share.
3. Remove personal paths, library names and pairing tokens from logs and screenshots.

If private reporting is unavailable, open a minimal public issue asking for a private channel. Do not include the vulnerability details in that issue.

I aim to acknowledge a report within a few business days and will tell you whether it is in scope. This is a small project, so timelines are best effort.

## In scope

- Pairing or authentication bypass.
- Reaching the admin panel or `/api/admin/*` from the phone listener or a remote client.
- Reading files outside the configured library folders.
- Directory listing, path disclosure, or arbitrary file access from the phone.
- Token leakage in HTML, JSON, logs, redirects or error pages.
- XSS or script injection in the phone UI, panel or pair page.
- Cache or service-worker behavior that exposes another device's data.
- Denial-of-service issues that are cheap to trigger and lock up the laptop.

## Out of scope

- Someone with physical access to the unlocked laptop.
- Someone on the same network who already knows the pairing token.
- The documented absence of TLS on the LAN link.
- Vulnerabilities in ffmpeg, adb, the browser or the operating system.
- Social engineering, spam, or issues that require a compromised device.
- Reports that only show a missing hardening header without a concrete impact.

## Privacy model

- There is no cloud service, account, telemetry or analytics.
- Video bytes are streamed from the laptop to the paired phone. Nothing is uploaded.
- The phone receives a catalogue and hashed media IDs. It never receives filesystem paths or a directory listing.
- The laptop panel is a separate HTTP listener bound to `127.0.0.1` with an ephemeral port. The main listener returns 403 to remote clients that ask for admin routes.
- `adb reverse` forwards only the phone port, never the admin port.
- Pairing uses a random 8-character token stored in the data folder. A successful pairing sets an `HttpOnly`, `SameSite=Lax` cookie.
- The LAN link is plain HTTP by design. Use USB debugging/localhost for the strongest isolation, and only run Trainu on a network you trust.

## Safe research

- Test only against your own laptop and your own phone.
- Do not access, modify or exfiltrate another person's library.
- Do not run automated scans against public hosts.
- Give the maintainer a reasonable window to fix the issue before publishing details.

Thank you for helping keep Trainu's users safe.
