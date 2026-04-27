# Architecture — Sanctum Desktop

A map of the codebase: which directory owns what, how the three Electron
processes talk, and where to look when adding a feature. Pair this with
[CONTRIBUTING.md](CONTRIBUTING.md) (workflow, commits, tests) and
[README.md](README.md) (what Sanctum Desktop is and how to run it).

## Top-level layout

```
src/
  main/                 ← Electron main process (Node — sidecar + IPC)
  preload/              ← contextBridge IPC surface
  renderer/             ← React UI (Chromium renderer)
scripts/
  build-sidecar.sh      ← PyInstaller build of the bundled Python backend
  sidecar_entry.py      ← PyInstaller entry into the `sanctum` package
sidecar-build/          ← PyInstaller output (per-OS-arch), gitignored
patches/                ← patch-package patches (e.g. docx-preview)
tests/
  unit/                 ← Vitest (renderer + main, isolated)
  integration/          ← Vitest with real backends
  e2e/                  ← Playwright drives a packaged Electron build
out/                    ← electron-vite build output
release/                ← electron-builder installer + unpacked tree
```

## The three processes

Electron splits the app across three processes that **never share memory**.
Cross-process work hops over IPC (renderer ↔ main) or HTTP (main ↔ sidecar).

```
                      Electron app
   ┌───────────────────────────────────────────────┐
   │  Main process (Node)                          │
   │  src/main/                                    │
   │   • spawns + supervises Python sidecar         │
   │   • exposes IPC handlers                       │
   │   • polls /health, broadcasts status           │
   └───────┬─────────────────────────┬──────────────┘
           │ contextBridge IPC       │ HTTP + bearer token
           │ (sandboxed)             │ (loopback only)
   ┌───────▼─────────────┐    ┌──────▼─────────────────┐
   │  Renderer (React)   │    │  Python sidecar         │
   │  src/renderer/      │    │  PyInstaller bundle of  │
   │   • UI + state      │    │  the `sanctum` repo,    │
   │   • talks to        │    │  served via Flask/      │
   │     sidecar via     │    │  waitress on a free     │
   │     fetch()         │    │  port chosen at boot.   │
   └─────────────────────┘    └─────────────────────────┘
```

Two important design choices:

- **The renderer talks to the sidecar directly** via `fetch()` after the
  main process hands it the base URL + bearer token through IPC. The main
  process is _not_ a relay for every request — that would force every
  endpoint into the IPC schema and double the surface to maintain.
- **The bearer token only reaches the renderer once the sidecar is
  healthy.** `src/main/status.ts::toPublicStatus` strips it from every
  non-`ready` state.

## What lives in each module

### `src/main/` — Electron main process

- `index.ts` — app lifecycle, window creation, IPC handler registration,
  URL allowlist (external links via `shell.openExternal`).
- `sidecar.ts` — spawns the sidecar (`SidecarHandle.kill` is graceful),
  feeds the bearer token to stdin, parses the `SANCTUM_READY host=… port=…`
  line, owns the lifetime.
- `paths.ts` — picks which executable to spawn (dev: sibling `sanctum`
  checkout; prod: PyInstaller binary under `extraResources/sidecar/`).
- `health.ts` — polls `/health` with a back-off until ready or timeout.
- `status.ts` — `StatusBus` (EventEmitter): single source of truth for the
  app's lifecycle state, with `toPublicStatus()` projecting to a
  renderer-safe view.
- `settings.ts` — JSON-backed `SettingsStore` under `app.getPath('userData')`;
  `settingsToEnv()` projects to `SANCTUM_<SECTION>__<KEY>` env vars so a
  settings change → sidecar respawn → backend picks up the new config.
- `models.ts` — Professional-tier model download flow (SHA-256 verified;
  the Standard tier is bundled into the PyInstaller output).

### `src/preload/` — IPC bridge

- `index.ts` — runs in a sandboxed preload context;
  `contextBridge.exposeInMainWorld('sanctum', api)` is the **only** thing
  the renderer can see. Everything else (`require`, `process`, raw
  `ipcRenderer`) is hidden.
- `sanctum.d.ts` — the `Window['sanctum']` type the renderer imports.
  Treat this as a **stable contract**: every change here ripples through
  every consumer in `src/renderer/`.

### `src/renderer/src/` — React UI

- `App.tsx` — top-level wiring: status, doc state, sessions client,
  drop-zone vs review-mode switch, providers.
- `main.tsx` — React 19 root + Zustand provider boot.
- `index.css` — global styles (we don't use a CSS-in-JS library).
- `sanctum.d.ts` — re-export of the bridge types so renderer code can
  `import type { ... } from '../sanctum'`.

#### `src/renderer/src/api/` — HTTP clients

Wraps the sidecar's REST API. Both clients are constructed once per
`{baseUrl, token}` change and passed down via props.

- `types.ts` — wire types for every request/response in scope. **Single
  source of truth for the renderer's contract with the backend.**
- `sessions.ts` — `SessionsClient`: list / create / get / patch decision
  / add user-added / delete user-added / commit / abandon.
- `mapping.ts` — `MappingClient`: lock / unlock the encrypted mapping store.

#### `src/renderer/src/components/` — React components

One file per visible surface; all consume the Zustand store and the API
clients via props. The non-obvious ones:

- `DocxView.tsx` — wraps `docx-preview` (with a `patches/` patch that
  emits `data-segment-id`), exposes the rendered root for highlight
  registration.
- `DetectionSidebar.tsx` + `DetectionTooltip.tsx` — paired: sidebar drives
  navigation; tooltip floats on the focused span.
- `PreviewOverlay.tsx` — ghost-text overlay rendered from
  `store.previews`.
- `MappingStoreChip.tsx` — header chip showing lock state; opens
  `UnlockModal` when clicked.
- `Splash.tsx` — pre-ready surface (idle / starting / waiting-for-health
  / error) keyed off `SanctumStatus`.
- `TypedError.tsx` — routes API errors to user-friendly copy keyed on
  status code (409, 413, 415, 503).
- `RecentSessions.tsx` — landing-page list backed by
  `GET /review-sessions`.
- `CommitPanel.tsx`, `SettingsModal.tsx`, `UnlockModal.tsx`,
  `SelectModeBanner.tsx` — modal/bottom-panel flows; all dismiss via
  Cancel button.

#### `src/renderer/src/review/` — Review-surface state

- `store.ts` — Zustand store: detections, focused id, undo stack, select
  mode, default operator, commit panel open, session id, last sync error,
  commit result, mapping-store lock state, previews, editing replacement.
  **The single in-memory model for the review surface.**
- `actions.ts` — `ReviewActions` interface with two factories:
  `localActions` (fake-detection mode) and `syncedActions(client, sessionId)`
  (real backend with optimistic+rollback). The keyboard handler and
  components see one uniform interface.
- `use-actions.tsx` — React context provider for the chosen actions
  factory; switches based on whether a session is open.
- `keyboard.ts` — global keyboard map (`a`/`r`/`m`/`u`/arrow nav/etc.).
  Reads actions through a ref so keys always hit the freshest closure.
- `from-session.ts` — projector: backend `ReviewSessionResponse` →
  renderer `Detection[]` + previews.
- `segments.ts` + `highlights.ts` — DOM-side helpers: locate
  `data-segment-id` ranges, register CSS Custom Highlight API entries
  (pending / accepted / rejected / focused).
- `fake-detections.ts` — local seeder used when no backend session exists
  (browser preview, unit tests).
- `types.ts` — renderer-side review enums (`OperatorName`, `Detection`,
  `Preview`).

## Build pipeline

`electron-vite build && electron-builder` (= `npm run make`). Two stages:

1. **electron-vite** transpiles TypeScript and bundles each process:
   - `out/main/index.js` (Node target, CommonJS)
   - `out/preload/index.js` (sandbox-safe, no Node API except contextBridge)
   - `out/renderer/index.html` + assets (browser target)
2. **electron-builder** packages `out/` plus the platform-specific
   PyInstaller bundle from `sidecar-build/<os>-<arch>/` into:
   - `release/linux-unpacked/` (a directory tree — runs anywhere)
   - `release/*.AppImage` / `*.deb` / `*.dmg` / `*.exe` (installers)

`electron-builder.yml::extraResources` is the bridge:
`sidecar-build/${os}-${arch}` → `resources/sidecar/` inside the app.
`src/main/paths.ts` reads from there at runtime.

The sidecar bundle itself is built separately by `scripts/build-sidecar.sh`
— see its docstring for the PyInstaller flag rationale (in particular
`--onedir` and the `--collect-all` chain). Run that **before** `npm run
make` if any backend code or config changed.

## Tests

```
tests/
  unit/
    main/           ← per-module Vitest (sidecar lifecycle, paths, settings, …)
    renderer/       ← happy-dom Vitest for components, store, actions, keyboard
  integration/      ← Vitest with a real spawned sidecar
  e2e/              ← Playwright + `_electron.launch` against the packaged build
```

- Unit tests stub IPC and `fetch`. Renderer specs use happy-dom and the
  `@vitest-environment` directive.
- Integration tests spawn the real Python sidecar (the dev-mode path)
  and exercise `src/main/` against it. They fail loudly if `sanctum` isn't
  installed in the sibling repo.
- E2E tests build, then launch the packaged Electron app and drive its
  renderer. Slow; not run in pre-commit.

## Where to start when adding…

| Goal                                  | First file to open                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| New IPC method                        | `src/preload/index.ts` + `src/main/index.ts` handler + `src/preload/sanctum.d.ts` type |
| New review action / keyboard shortcut | `src/renderer/src/review/actions.ts` + `keyboard.ts`                                   |
| New REST call to the sidecar          | `src/renderer/src/api/sessions.ts` (or `mapping.ts`) + `types.ts`                      |
| New visible surface                   | `src/renderer/src/components/<Name>.tsx`, mount in `App.tsx`                           |
| New runtime setting                   | `src/main/settings.ts` (shape + projection) + `SettingsModal.tsx` (UI)                 |
| Sidecar lifecycle change              | `src/main/sidecar.ts` (spawn) + `health.ts` (readiness)                                |
| Backend bundling fix                  | `scripts/build-sidecar.sh` (PyInstaller flags)                                         |

## Invariants worth knowing before changing things

- **Sidecar token never enters argv or disk.** It's sent on stdin to
  `sanctum-sidecar serve --token-stdin` and held in `StatusBus` in the
  main process. The renderer only sees it once status is `ready`.
- **Loopback only.** The sidecar binds `127.0.0.1`. Do not change this
  without a deep look at the threat model — the desktop app's only
  "user" should be the local renderer.
- **All backend calls go through the API clients in `src/renderer/src/api/`.**
  Renderer components never construct `fetch()` calls inline. New
  endpoints add a method on the client + a wire type in `types.ts`.
- **The `window.sanctum` bridge is a stable contract.** Treat changes
  there like API changes: rename → both sides must update; add → no
  rush; remove → coordinate.
- **Sidecar respawns on settings save.** `src/main/index.ts` kills the
  old sidecar, projects the new settings to env vars, spawns a fresh
  one. The renderer's existing splash UX handles the transient
  `starting` / `waiting-for-health` states for free.
- **AppImage doesn't run on WSL2.** FUSE isn't available; use
  `release/linux-unpacked/sanctum-desktop` for local end-to-end testing.
  CI's `ubuntu-latest` runner is the AppImage's actual validation environment.
