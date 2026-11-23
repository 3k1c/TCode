# TCode Headless Runtime Refactor — 2026-11-23

## Single source of truth

This tree combines the GitHub fork with the uncommitted source that built the current Windows installation.
The original working tree at `tcode-web-icon-20261122` was not modified.
Recovered features include Chromium browser integration, web push, file uploads, and their renderer UI.

Build with `npm run build:release -w packages/headless` from the repository root.
This invokes the desktop build with `VITE_TCODE_HEADLESS=1` before bundling the headless server.
Never deploy a renderer built without that flag: it disables browser uploads and headless folder selection.

## Lifecycle fixes

- `shell.run` and `git.exec` complete on the direct child's exit, with at most 1500 ms pipe drain.
- A pipe still open after the grace period is closed and `outputIncomplete` is reported.
- Windows cancellation snapshots child process identities and verifies creation times before terminating survivors.
- Linux cancellation uses process groups.
- A quiet command emits an informational progress notice after 120 seconds without output; silence is not an automatic failure.
- Pi Agent abort is bounded to a 10-second UI wait, but a timeout does not replace or reload a live session.
- WebSocket reconnect emits `session:runtimeSnapshot`; the renderer reconciles immediately, with a 30-second fallback check.
- Stop and Follow-up buttons have non-shrinking dimensions on mobile.
- Non-DOM preference hydration is guarded, preserving Node-based tests.

## Verification

- Backend: 637 / 637 tests passed on Windows.
- Desktop: 946 / 946 tests passed on Windows.
- Headless: 34 / 34 tests passed on Windows.
- TypeScript typechecks: backend, desktop and headless passed.
- Chromium browser tool: actual create/evaluate/status/frame/destroy test passed.
- Push API, service worker, icons and manifest: HTTP 200 and expected content.
- WebSocket runtime snapshot: actual authenticated WebSocket test passed.
- Windows process tree cancellation and inherited stdout: actual regression tests passed.

## Deployment rules

- Do not replace the live Windows installation with the old `headless-nas` build.
- Stage and verify this unified build, including browser file uploads.
- Back up live server, renderer, version and package metadata before switching.
- On failure, restore the backup and restart the previous server.
- Preserve Pi session files, existing configuration, tokens and uncommitted user work.
- Do not force-reload a streaming Pi Session to simulate a successful abort.

## Remaining limitation

The Pi SDK built-in `bash` tool has its own process runner. The local Component Shell fixes do not replace that SDK implementation.
Pi SDK 1.4.0 already contains a child-exit / idle-pipe drain helper.
Model inference quality, API 520 responses and arbitrary third-party tools are independent failure domains.
