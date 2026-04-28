# CLAUDE.md — Sanctum Desktop

Electron front-end for Sanctum's local-first PII anonymization engine. The
Python sidecar is the [`sanctum`](https://github.com/FilippoTonci/sanctum)
package, packaged via PyInstaller and spawned by the Electron main process.
**All processing must be offline** — no runtime network calls.

For the per-folder map of what lives where, read [`ARCHITECTURE.md`](ARCHITECTURE.md).
For workflow + commit conventions, [`CONTRIBUTING.md`](CONTRIBUTING.md).
This file is the operating manual when working _with Claude_ in this repo.

## Session start

- Run `npm install` then `npm run prepare` (sets up husky hooks).
- For dev-mode sidecar spawning, have a sibling [`sanctum`](https://github.com/FilippoTonci/sanctum)
  checkout with `pip install -e '.[security,api,documents]'` in its venv.

## Work plans, commits, PRs

This repo's plan lives in
[`sanctum/plans/phase-3-desktop-ui.md`](https://github.com/FilippoTonci/sanctum/blob/main/plans/phase-3-desktop-ui.md)
(versioned in the backend repo so cross-repo references stay coherent).
Mirror that structure onto git the same way the backend does:

- **One PR per workstream** — a WS is the unit of review. Open the PR
  against `main` when the WS starts; keep it in draft while substeps land.
- **One commit per substep** — commit progressively as each substep
  finishes (lint clean, tests green, pre-commit clean). Commit subject
  names the phase/workstream, e.g.
  `Wire real commit + abandon (Phase 3 WS5)`.
- Before starting a WS, confirm with the user which WS we're on and
  create the branch + draft PR. Before each substep commit, show the
  diff and confirm it's the right slice.
- If a substep surfaces unrelated cleanup, split it into its own commit
  (or its own PR if it crosses WS boundaries) — don't smuggle it in.

## Keep the README roadmap in sync

When a substep / WS / Phase item lands, **edit the matching `[ ]` →
`[x]` in `README.md` (this repo) and in
[`sanctum/README.md`](https://github.com/FilippoTonci/sanctum/blob/main/README.md)
when the work touches the backend contract**. Update the status callout
near the top of each README too if the high-level state shifted (e.g.
"WSx in flight" → "WSx shipped"). Bundle the README change into the
same commit as the substep when it's small; otherwise commit it right
after. Don't tick a box for work that's merged but not yet released —
installer line items require **signed** builds before they flip.

## Architecture — three processes, never share memory

```
src/main/         Node main process — sidecar lifecycle + IPC handlers
src/preload/      contextBridge surface exposed as window.sanctum
src/renderer/     React UI (Chromium, sandboxed)
scripts/          PyInstaller build of the Python sidecar
```

Hard rule: the renderer talks to the sidecar **directly via fetch()**
once the main process hands it `{ baseUrl, token }` through IPC. The
main process is _not_ a relay for every request — that doubles the
surface to maintain. The bearer token only reaches the renderer once
status is `ready` (`src/main/status.ts::toPublicStatus` strips it
otherwise).

Read `ARCHITECTURE.md` before touching cross-process boundaries.

## Airgap invariant

No runtime network calls. The sidecar is always spawned with
`HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` so a missing model
fails fast instead of triggering an HTTP fetch. The only allowed
network usage is the user-confirmed model download in
`src/main/models.ts` (Pro-tier weights at install/upgrade time, with
SHA-256 verification).

## Sidecar contract

- Spawn: `sanctum-sidecar serve --port 0 --token-stdin`. Token is
  written to stdin once, never to argv or disk.
- Ready signal: a single `SANCTUM_READY host=… port=… token_source=stdin`
  line on stdout. `src/main/sidecar.ts` parses that to learn the port.
- Loopback only. Don't change the bind address without re-reading the
  threat model.
- The packaged binary lives at
  `process.resourcesPath/sidecar/sanctum-sidecar[.exe]`; in dev we
  spawn `sanctum` from the sibling checkout. `src/main/paths.ts`
  branches on `ELECTRON_DEV`.

## Quality gates (enforced, don't weaken without asking)

- ESLint with `--max-warnings=0` — pre-commit blocks on warnings too.
- TypeScript strict (`tsc --build --force`) — no implicit any, all
  union narrowing must be exhaustive.
- Vitest unit suites must pass; renderer specs use happy-dom (mark
  with `@vitest-environment happy-dom`).
- Playwright e2e is for the packaged build; not run in pre-commit
  (slow), but kept green in CI.

## Running things

```bash
npm run dev                   # electron-vite dev w/ HMR; spawns sibling sanctum
npm run build                 # electron-vite build → out/
npm run make                  # build + electron-builder package → release/
npm test                      # vitest run (unit lane)
npm run test:integration      # integration lane (real spawned sidecar)
npm run test:e2e              # Playwright against packaged Electron
npm run lint && npm run typecheck

SANCTUM_REPO=../sanctum bash scripts/build-sidecar.sh   # rebuild sidecar bundle
```

When the sidecar bundle changes (any sanctum-side dep change, version
bump, or extras toggle), nuke `sidecar-build/{work,spec,dist,linux-x64}`
before rerunning the build script — PyInstaller caches the spec file
and silently skips new collectors otherwise.

## Conventions

- IPC channel names live as constants at the top of
  `src/main/index.ts` and `src/preload/index.ts` — both must agree.
- Bridge methods exposed via `contextBridge.exposeInMainWorld('sanctum', api)`
  are a **stable contract**: rename → both sides update together; add →
  no rush; remove → coordinate.
- Renderer never constructs `fetch()` calls inline. New endpoints add a
  method to the appropriate client in `src/renderer/src/api/` plus a
  wire type in `types.ts`.
- React components consume the Zustand store and the API clients via
  props/context — no module-level singletons.
- Settings keys mirror the sidecar's
  `SANCTUM_<SECTION>__<KEY>` env-var convention so a save → respawn
  round-trip is a single function (`settingsToEnv` in
  `src/main/settings.ts`).

## WSL2 caveat

The `.AppImage` artifact relies on FUSE which is unavailable on WSL2;
launching it errors with `dlopen(): error loading libfuse.so.2`. For
local end-to-end testing inside WSL2, run
`release/linux-unpacked/sanctum-desktop` directly. The AppImage gets
validated on `ubuntu-latest` runners in CI, which is what real users hit.

## Where to look before duplicating work

- `README.md` — what the app is, getting started, roadmap.
- `ARCHITECTURE.md` — module-by-module map, three-process model, build
  pipeline, "where to start when adding X" cheat-sheet.
- `CONTRIBUTING.md` — workflow, commits, tests.
- `electron-builder.yml` — packaging config (extraResources path → sidecar).
- `scripts/build-sidecar.sh` — PyInstaller flag rationale.
