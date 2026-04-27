import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import type { Readable, Writable } from 'node:stream'
import { resolveSidecarCommand, type SidecarCommand } from './paths'

type SpawnedChild = ChildProcess & { stdin: Writable; stdout: Readable }

export interface SidecarConfig {
  readonly host: string
  readonly port: number
  readonly token: string
  readonly baseUrl: string
}

export interface SidecarHandle extends SidecarConfig {
  readonly child: ChildProcess
  kill(): Promise<void>
}

export interface SpawnOptions {
  readonly readyTimeoutMs?: number
  readonly killTimeoutMs?: number
  readonly commandResolver?: () => SidecarCommand
  readonly spawnFn?: typeof spawn
  /**
   * Extra environment variables merged on top of the resolver's default
   * env (which itself layers over `process.env`). Used by the settings
   * IPC respawn flow to inject `SANCTUM_NLP__NER_BACKEND` etc. without
   * touching the resolver.
   */
  readonly envOverrides?: Record<string, string>
}

const READY_PATTERN = /SANCTUM_READY\s+host=(\S+)\s+port=(\d+)/
const DEFAULT_READY_TIMEOUT_MS = 60_000
const DEFAULT_KILL_TIMEOUT_MS = 5_000

/**
 * Spawn the Python sidecar, wait for its `SANCTUM_READY` handshake, and
 * return a handle the caller can use to hit the API (`baseUrl`, `token`)
 * and shut the process down (`kill`).
 *
 * The token is generated here (32 random bytes, hex-encoded) and piped
 * over stdin. `stdin.end()` closes the pipe immediately so the token
 * cannot be read twice and so a crashed main process can't accidentally
 * re-serve it on resume.
 */
export async function spawnSidecar(options: SpawnOptions = {}): Promise<SidecarHandle> {
  const readyTimeout = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
  const killTimeout = options.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS
  const resolver = options.commandResolver ?? defaultCommandResolver
  const spawnImpl = options.spawnFn ?? spawn

  const { command, args, cwd, env } = resolver()
  const token = randomBytes(32).toString('hex')

  // stdio: ['pipe', 'pipe', 'pipe'] guarantees non-null stdio pipes at
  // runtime. Narrow via SpawnedChild so downstream code doesn't have to
  // guard on every access.
  const child = spawnImpl(command, [...args], {
    cwd,
    env: { ...process.env, ...env, ...(options.envOverrides ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as SpawnedChild

  child.stdin.write(`${token}\n`)
  child.stdin.end()

  const { host, port } = await awaitReady(child, readyTimeout)

  return {
    host,
    port,
    token,
    baseUrl: `http://${host}:${port.toString()}`,
    child,
    kill: () => killSidecar(child, killTimeout),
  }
}

/**
 * Kill the spawned sidecar with the standard graceful-shutdown escalation.
 * SIGTERM first; if the process is still alive after `killTimeoutMs`,
 * SIGKILL to guarantee the desktop app can exit.
 *
 * Windows has no real SIGTERM. The sidecar's Python SIGTERM handler (WS1
 * substep 5) wires a console control handler that catches
 * `CTRL_CLOSE_EVENT` and routes it through the same cleanup path, so
 * `child.kill('SIGTERM')` works uniformly.
 */
export async function killSidecar(
  child: ChildProcess,
  timeoutMs: number = DEFAULT_KILL_TIMEOUT_MS,
): Promise<void> {
  if (child.exitCode !== null || child.killed) return

  child.kill('SIGTERM')

  const exited = once(child, 'exit').then(() => 'exited' as const)
  const timedOut = new Promise<'timeout'>((resolve) => {
    setTimeout(() => {
      resolve('timeout')
    }, timeoutMs)
  })

  const outcome = await Promise.race([exited, timedOut])
  if (outcome === 'timeout') {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

function awaitReady(
  child: SpawnedChild,
  timeoutMs: number,
): Promise<{ host: string; port: number }> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    let settled = false

    const timer = setTimeout(() => {
      finish()
      reject(new Error(`sidecar did not emit SANCTUM_READY within ${timeoutMs.toString()}ms`))
    }, timeoutMs)

    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.off('exit', onExit)
      child.off('error', onError)
    }

    const onData = (chunk: Buffer | string): void => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      const match = READY_PATTERN.exec(buffer)
      if (match !== null) {
        const host = match[1]
        const portStr = match[2]
        if (host === undefined || portStr === undefined) return
        finish()
        resolve({ host, port: Number.parseInt(portStr, 10) })
      }
    }

    const onExit = (code: number | null): void => {
      finish()
      reject(new Error(`sidecar exited with code ${String(code)} before ready`))
    }

    const onError = (err: Error): void => {
      finish()
      reject(err)
    }

    child.stdout.on('data', onData)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

function defaultCommandResolver(): SidecarCommand {
  const dev = process.env.ELECTRON_DEV === '1'
  const devRepoPath = process.env.SANCTUM_DEV_REPO
  const resourcesPath =
    typeof process.resourcesPath === 'string' ? process.resourcesPath : process.cwd()

  return resolveSidecarCommand({
    platform: process.platform,
    resourcesPath,
    dev,
    devRepoPath,
  })
}
