import { join } from 'node:path'

export interface SidecarCommand {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly env: NodeJS.ProcessEnv
}

export interface ResolveSidecarOptions {
  readonly platform: NodeJS.Platform
  readonly resourcesPath: string
  readonly dev: boolean
  readonly devRepoPath: string | undefined
}

/**
 * Decide which executable to spawn as the Python backend, given the
 * current process context.
 *
 * In dev mode (`ELECTRON_DEV=1`) we spawn the installed `sanctum` CLI from
 * a sibling checkout — this is the WS3 substep 8 path, so backend
 * iteration doesn't require rebuilding the PyInstaller bundle on every
 * change.
 *
 * In production we launch the binary PyInstaller emits under
 * `extraResources/sidecar/` — different name per OS (`sanctum-sidecar.exe`
 * on Windows). That onedir output is bundled into the installer by
 * `electron-builder` and lives next to the app at runtime.
 *
 * Either path passes `--port 0 --token-stdin` so the sidecar picks its own
 * free port and reads the bearer token from stdin — never disk, never
 * argv. The environment sets the airgap invariants (`HF_HUB_OFFLINE=1`,
 * `TRANSFORMERS_OFFLINE=1`) so a missing model fails fast instead of
 * attempting a runtime network call.
 */
export function resolveSidecarCommand(opts: ResolveSidecarOptions): SidecarCommand {
  const baseEnv: NodeJS.ProcessEnv = {
    PYTHONUNBUFFERED: '1',
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
  }

  const args = ['serve', '--port', '0', '--token-stdin']

  if (opts.dev) {
    const cwd = opts.devRepoPath ?? '../sanctum'
    return {
      command: 'sanctum',
      args,
      cwd,
      env: baseEnv,
    }
  }

  const binary = opts.platform === 'win32' ? 'sanctum-sidecar.exe' : 'sanctum-sidecar'
  return {
    command: join(opts.resourcesPath, 'sidecar', binary),
    args,
    env: baseEnv,
  }
}
