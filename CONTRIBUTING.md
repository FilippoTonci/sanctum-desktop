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

- The TypeScript wire types in `src/renderer/src/api/types.ts` are
  hand-written and mirror `schema/openapi.json` in the `sanctum` repo,
  pinned to a specific commit per release. (Generating them is a
  possibility, not a fact — don't describe it as one.)
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
- `npm run typecheck` — `tsc --build --force`. Strict mode, no implicit
  any, no unchecked indexed access.
- `npm test` — Vitest unit lane.
- `npm run test:e2e` — Playwright against the built `out/` bundle with
  `SANCTUM_SKIP_SIDECAR=1`. Smoke only today.
- `npm run test:integration` spawns a real sidecar and needs the sibling
  `sanctum` checkout, so CI does **not** run it. Run it locally when you
  touch `src/main/`.
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
6. **Signed installers before any distribution.** No unsigned `.dmg` /
   `.msi` / `.AppImage` ever ships to a user, including pre-release
   channels. Locally built unsigned artifacts are expected and fine —
   they just never leave your machine.
7. **The installer always contains its sidecar.** `scripts/before-pack.cjs`
   enforces this; don't route around it. A packaging change that makes the
   sidecar optional is the one bug that ships silently.

Not yet guardrails, but planned — don't write docs that describe them as
though they were:

- **i18n.** `react-i18next` is a WS6 item and is not installed. Component
  source still carries English string literals.
- **Backend contract verification.** `/health` reports `sanctum_commit`
  and `openapi_digest`; nothing checks them yet.

## Local development

```bash
git clone https://github.com/FilippoTonci/sanctum-desktop.git
cd sanctum-desktop
npm install
npm run prepare   # husky hooks
npm run dev
```

Dev mode spawns the sidecar from a sibling `../sanctum` checkout (via
`pip install -e '.[security,api,documents]'` in its `.venv`) instead of the
packaged binary, so backend iteration doesn't require rebuilding
PyInstaller output. `npm run dev` sets `ELECTRON_DEV=1`,
`SANCTUM_DEV_REPO=../sanctum`, and the venv `PATH` inline — nothing loads
a `.env` file, so export those yourself if you launch Electron another
way.

## Filing issues

- **Backend bugs** (analyser misses, anonymiser output, API behaviour) →
  [`sanctum`](https://github.com/FilippoTonci/sanctum/issues).
- **GUI bugs** (rendering, keyboard nav, packaging, signing) → here.

If you're not sure which side a bug lives on, file it here and we'll move
it.

## Pull request checklist

- [ ] Branch named `phase-N/ws<M>-<short-slug>`, `fix/<short-slug>`, or
      `chore/<short-slug>`.
- [ ] Commits scoped to one substep each, with the phase/workstream
      tag in the subject.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` all green locally.
- [ ] No new `BrowserWindow` without sandbox + contextIsolation.
- [ ] No new `fetch` to anything other than `window.sanctum.baseUrl`.
- [ ] Docs updated **in the same commit** as the behaviour they describe —
      the README roadmap box, and any module list in `ARCHITECTURE.md`
      whose directory you added to or deleted from.

## License

By contributing, you agree your contributions are licensed under the MIT
License (see `LICENSE`).
