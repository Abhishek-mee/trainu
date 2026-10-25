# Contributing to Trainu

Thanks for taking a look. Trainu is a small, deliberately boring codebase: Node.js, plain JavaScript, plain CSS, and no runtime dependencies. Contributions that keep it that way are very welcome.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Good first contributions

- Reproduce a bug on a different phone, browser or operating system and add the details to an issue.
- Improve the USB troubleshooting steps for a phone maker that behaves differently.
- Add a test for an auth, range, progress or scanning edge case.
- Improve keyboard focus, screen-reader labels or reduced-motion behavior.
- Fix documentation that is unclear or out of date.

If you want to work on something larger, open an issue first so we can agree on the shape of the change.

## Ground rules

Trainu has a few invariants that are not negotiable:

1. **No runtime npm dependencies.** The app runs with `node` alone. Do not add a bundler, framework, transpiler, lockfile or CDN asset.
2. **Offline first.** The UI must not call an external service. No analytics, telemetry, fonts, images or scripts from the internet.
3. **Privacy by construction.** The phone must never receive a filesystem path, a folder listing, or access to the admin listener. Media stays addressed by hashed IDs.
4. **Two audiences, two designs.** The phone is Netflix-inspired (black, red, cinematic). The laptop panel is Runway-inspired monochrome. Do not apply one theme to the other, and never use Netflix logos, wordmarks or assets.
5. **The player contract.** Keep HTTP Range/206 and HEAD support. Keep sidecar subtitle and resume behavior working.
6. **No fake engagement.** Do not add star-begging widgets, fake testimonials, fake user counts or purchased promotion to the repository.

## Setup

You need Node.js 20 or newer. There is no install step.

```bash
git clone https://github.com/Abhishek-mee/trainu.git
cd trainu
npm test
npm start
```

`npm start` opens the laptop panel. For a throwaway instance:

```powershell
node bin/trainu.mjs --port 0 --data "$env:TEMP\trainu-dev" --no-open
```

Open the **printed admin URL**, not the main port's `/desktop`. Pair a phone with the code in the panel.

ffmpeg and adb are optional. If you need them, put them under `tools/ffmpeg/` and `tools/platform-tools/` (both ignored by Git), or point the app at them with the panel or environment variables. Do not commit downloaded binaries.

## Tests

```bash
npm test
node --test test/server.test.mjs
node --test test/units.test.mjs
node --test --test-name-pattern="watch progress" test/server.test.mjs
```

The integration tests start real HTTP servers on free ports with temporary libraries. Add a test when you change a route, auth rule, range behavior, progress handling or scanning behavior.

Before opening a pull request, also check the manual flows that automation cannot cover:

- pair a phone and play a video over USB and Wi-Fi;
- confirm `/api/library` contains no `filePath`;
- confirm the admin port is loopback-only and is not forwarded by `adb reverse`;
- confirm an unpaired remote client gets 401/403;
- check the phone at 393×851, 360×800 and 320×800, and the panel at 1120, 860 and 660 px.

## Code style

- ES modules on the server; browser scripts are dependency-free IIFEs.
- Two-space indentation, single quotes, semicolons, trailing commas where the surrounding code uses them.
- Prefer small named functions and explicit error handling over clever abstractions.
- Keep comments for *why*, not *what*.
- Do not reformat unrelated files in the same pull request.

## Commits and pull requests

- Write an imperative subject line, for example `Fix USB prompt wait after adb restart`.
- Keep each pull request focused. One behavior change per PR is ideal.
- Describe what changed, why, and how you tested it.
- Include screenshots for visible UI changes. Use the synthetic demo library, never a personal one.
- Link the issue the pull request closes, if there is one.

A maintainer will review as soon as possible. Small fixes usually move fastest.

## Reporting bugs

Use the [bug report form](https://github.com/Abhishek-mee/trainu/issues/new?template=bug_report.yml). Include:

- operating system and Node version (`node --version`);
- phone model, browser and connection method (USB debugging, USB tethering or Wi-Fi);
- exact steps to reproduce;
- what you expected and what happened;
- relevant server output with **paths, tokens and personal filenames removed**.

For a security issue, do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
