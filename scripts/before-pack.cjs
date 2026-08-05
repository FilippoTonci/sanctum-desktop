/**
 * electron-builder `beforePack` hook — refuse to package an app whose
 * Python sidecar is missing.
 *
 * Why this exists: `extraResources` treats a missing `from:` path as
 * informational. It logs `file source doesn't exist`, carries on, and
 * exits 0 — producing an installer that looks completely legitimate
 * (right name, plausible size, no warning) and cannot work, because the
 * backend it spawns isn't inside it.
 *
 * That is the worst possible failure mode for a release artifact: silent,
 * and indistinguishable from success until a user launches it. PyInstaller
 * only builds for the host arch and `sidecar-build/` is gitignored, so a
 * fresh CI checkout hits this by default rather than by accident.
 *
 * Failing here turns "ships broken" into "never builds".
 */

const { existsSync } = require('node:fs')
const { join } = require('node:path')
const { Arch } = require('electron-builder')

/** electron-builder's platform names → the `${os}` token used by extraResources. */
const OS_TOKEN = {
  darwin: 'mac',
  win32: 'win',
  linux: 'linux',
}

exports.default = async function beforePack(context) {
  const os = OS_TOKEN[context.electronPlatformName]
  if (os === undefined) {
    throw new Error(`beforePack: unrecognised platform "${context.electronPlatformName}"`)
  }

  // context.arch is the numeric builder-util Arch enum; Arch[n] gives the
  // same token electron-builder interpolates into ${arch} (x64, arm64, …).
  const arch = Arch[context.arch]
  const repoRoot = join(__dirname, '..')
  const bundleDir = join(repoRoot, 'sidecar-build', `${os}-${arch}`)
  const binary = join(bundleDir, os === 'win' ? 'sanctum-sidecar.exe' : 'sanctum-sidecar')

  if (existsSync(binary)) return

  throw new Error(
    [
      '',
      `Refusing to package: no sidecar bundle for ${os}-${arch}.`,
      '',
      `  expected: ${binary}`,
      '',
      'extraResources would have skipped it silently and produced an',
      'installer with no backend inside. Build the sidecar first:',
      '',
      `  PYTHON=python3.12 SANCTUM_REPO=../sanctum bash scripts/build-sidecar.sh`,
      '',
      'PyInstaller cannot cross-compile, so the sidecar must be built on a',
      `${os}-${arch} machine. If this fired in CI, that job is missing its`,
      'build-sidecar step or is running on the wrong runner.',
      '',
    ].join('\n'),
  )
}
