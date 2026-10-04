#!/usr/bin/env node
// Launch the built Sanctum Desktop app with its own, throwaway Electron user data.
//
// Why: Electron resolves `userData` under ~/Library/Application Support/Electron
// regardless of HOME, so concurrent runs (overnight lanes, tests, walkthroughs)
// all shared one settings.json. Passing --user-data-dir per run fixes that.
//
// CLI:   SANCTUM_REPO=/path/to/engine node scripts/launch-isolated.mjs [--home <dir>]
//        prints {"pid":…,"userData":…} on stdout, then keeps the app running
//        until it is closed or the script receives SIGINT/SIGTERM.
// Module: import { launchIsolated } from './launch-isolated.mjs'
//        const { app, win, home, userData, close } = await launchIsolated({ home })
//
// Needs `npm run build` first (out/main/index.js). SANCTUM_REPO is the engine
// checkout the Python sidecar runs from; unset means SANCTUM_SKIP_SIDECAR=1.
// SANCTUM_VENV (default $SANCTUM_REPO/.venv) is the Python venv for the sidecar.
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function launchIsolated({ home, extraEnv = {} } = {}) {
  const require = createRequire(join(desktopDir, 'package.json'))
  const { _electron: electron } = require('@playwright/test')
  home = resolve(home ?? mkdtempSync(join(tmpdir(), 'sanctum-home-')))
  mkdirSync(join(home, 'userData'), { recursive: true })
  // realpath after mkdir (works for --home too): macOS tmpdir is under the /var
  // symlink, which the engine refuses as an output path.
  home = realpathSync(home)
  const userData = join(home, 'userData')

  const repo = process.env.SANCTUM_REPO
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'),
    ),
    HOME: home,
    ELECTRON_DISABLE_SANDBOX_WARNING: '1',
  }
  if (repo) {
    const engine = resolve(repo)
    env.ELECTRON_DEV = '1'
    env.SANCTUM_DEV_REPO = engine
    // Engine checkout wins over any editable install in the venv.
    env.PYTHONPATH = engine
    env.PATH = [
      join(process.env.SANCTUM_VENV ?? join(engine, '.venv'), 'bin'),
      process.env.PATH,
    ].join(delimiter)
  } else {
    env.SANCTUM_SKIP_SIDECAR = '1'
  }
  Object.assign(env, extraEnv)

  const app = await electron.launch({
    args: [join(desktopDir, 'out/main/index.js'), `--user-data-dir=${userData}`],
    cwd: desktopDir,
    env,
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  return { app, win, home, userData, close: () => app.close() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--home')
  const home = i > -1 ? process.argv[i + 1] : undefined
  const { app, userData } = await launchIsolated({ home })
  console.log(JSON.stringify({ pid: app.process().pid, userData }))
  const stop = () => app.close().finally(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  app.on('close', () => process.exit(0))
}
