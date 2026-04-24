# Contributing to Sanctum Desktop

Thank you for considering a contribution. This repo is the Electron shell of
the [Sanctum](https://github.com/FilippoTonci/sanctum) project — a local-first,
air-gapped document anonymization tool. The backend engine, CLI, and HTTP API
live in the `sanctum` repo; this repo is the user-facing GUI that consumes
them.

Please read this document before opening a PR.

## Repo boundary

The contract between the two repos is **one-way**: this repo depends on the
`sanctum` HTTP API; `sanctum` does not import, link, or build against
anything here. Concretely:

- The TypeScript API client is generated from `schema/openapi.json` in the
  `sanctum` repo, pinned to a specific commit per release.
- The Python sidecar binary is built from a pinned `sanctum` commit and
  shipped inside the installer. The pin is atomic — an installed desktop
  always talks to the sidecar built from the same commit it was tested
  against.
- No Python lives in this repo. No TypeScript or Node code lives in
  `sanctum`.

If a desktop change requires a backend change, open the backend PR first
against `sanctum`, get it merged, then bump the `sanctum` pin here in a
follow-up.

## Workstreams, branches, commits

Work is organised around the Phase 3 plan in
[`sanctum/plans/phase-3-desktop-ui.md`](https://github.com/FilippoTonci/sanctum/blob/main/plans/phase-3-desktop-ui.md).

- **One PR per workstream.** A WS is the unit of review. Open the PR against
  `main` when the WS starts; keep it in draft while substeps land.
- **One commit per substep.** Commit progressively — don't batch a whole
  workstream into one commit. Commit subjects name the phase/workstream,
  e.g. `Wire Vitest unit harness (Phase 3 WS2)`.
- If a substep surfaces unrelated cleanup, split it into its own commit (or
  its own PR if it crosses WS boundaries).

## Quality gates (enforced by CI)

- `npm run lint` — ESLint with `@typescript-eslint`, `react-hooks`,
  `jsx-a11y`. Zero warnings.
- `npm run format:check` — Prettier.
- `npm run typecheck` — `tsc --build --noEmit`. Strict mode, no implicit
  any, no unchecked indexed access.
- `npm test` — Vitest unit suite.
- `npm run test:e2e` — Playwright E2E (smoke at minimum; review-flow tests
  as WS4 lands).
- `npm run build` cross-platform on `macos-latest`, `windows-latest`,
  `ubuntu-latest`.

Pre-commit (`husky` + `lint-staged`) runs ESLint and Prettier on staged
files before each commit.

## Architectural guardrails

These are load-bearing for the project's positioning. PRs that violate them
will be sent back regardless of how clean the diff is.

1. **Airgap.** No runtime network calls. The sidecar's environment sets
   `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`. The renderer has a
   `webRequest` filter blocking everything except `127.0.0.1`. The one
   exception is the user-confirmed model-download flow (WS3 substep 6),
   which fetches from a Sanctum-owned CDN.
2. **Renderer is paint-only.** The Electron renderer never mutates the
   `.docx` locally. It renders, captures decisions, and posts them to the
   backend; the backend writes the output file.
3. **Sidecar lifecycle is the main process's job.** The renderer never
   spawns the Python backend, never reads tokens from disk, and never
   talks to a backend it did not start.
4. **Sandboxed renderer.** `contextIsolation: true`, `nodeIntegration: false`,
   `sandbox: true` in every `BrowserWindow`. ASAR integrity on. No `eval`.
5. **No telemetry.** Crash reports may land in Phase 4 as opt-in
   local-only (no upload). Not before.
6. **i18n from day one.** No English string literals in component source —
   everything goes through `react-i18next`. French catalog stubbed.
7. **Signed installers only.** No unsigned `.dmg` / `.msi` / `.AppImage`
   ever ships, including pre-release channels.

## Local development

```bash
git clone https://github.com/FilippoTonci/sanctum-desktop.git
cd sanctum-desktop
npm install
cp .env.example .env.local   # set ELECTRON_DEV=1 and SANCTUM_DEV_REPO=../sanctum
npm run dev
```

Dev mode spawns the sidecar from a sibling `../sanctum` checkout (via
`pip install -e .` in a venv) instead of the packaged binary, so backend
iteration doesn't require rebuilding PyInstaller output.

## Filing issues

- **Backend bugs** (analyser misses, anonymiser output, API behaviour) →
  [`sanctum`](https://github.com/FilippoTonci/sanctum/issues).
- **GUI bugs** (rendering, keyboard nav, packaging, signing) → here.

If you're not sure which side a bug lives on, file it here and we'll move
it.

## Pull request checklist

- [ ] Branch named `phase-N/ws<M>-<short-slug>` or `fix/<short-slug>`.
- [ ] Commits scoped to one substep each, with the phase/workstream
      tag in the subject.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` all green locally.
- [ ] No new English strings in component source (use the i18n catalog).
- [ ] No new `BrowserWindow` without sandbox + contextIsolation.
- [ ] No new `fetch` to anything other than `window.sanctum.baseUrl`.
- [ ] Updated `RELEASE.md` if the change affects packaging or signing.

## License

By contributing, you agree your contributions are licensed under the MIT
License (see `LICENSE`).
