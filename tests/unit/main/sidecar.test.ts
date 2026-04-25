import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { killSidecar, spawnSidecar } from '../../../src/main/sidecar'

interface FakeChild extends EventEmitter {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  exitCode: number | null
  killed: boolean
  kill: (signal?: NodeJS.Signals | number) => boolean
}

function makeFakeChild(): FakeChild {
  const emitter = new EventEmitter() as FakeChild
  emitter.stdin = new PassThrough()
  emitter.stdout = new PassThrough()
  emitter.stderr = new PassThrough()
  emitter.exitCode = null
  emitter.killed = false
  emitter.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    emitter.killed = true
    // Simulate the process exiting on SIGTERM after a microtask.
    queueMicrotask(() => {
      emitter.exitCode = signal === 'SIGKILL' ? 137 : 0
      emitter.emit('exit', emitter.exitCode, signal)
    })
    return true
  })
  return emitter
}

describe('spawnSidecar', () => {
  let fake: FakeChild

  beforeEach(() => {
    fake = makeFakeChild()
  })

  it('pipes the token over stdin, parses SANCTUM_READY, and resolves with baseUrl + token', async () => {
    const stdinWrites: string[] = []
    fake.stdin.on('data', (chunk: Buffer) => stdinWrites.push(chunk.toString('utf8')))

    const spawnFn = vi.fn(() => fake as never)
    const handlePromise = spawnSidecar({
      spawnFn,
      commandResolver: () => ({
        command: 'fake',
        args: ['serve'],
        env: {},
      }),
    })

    // Let the implementation attach its listeners and flush stdin.
    await Promise.resolve()

    fake.stdout.write('SANCTUM_READY host=127.0.0.1 port=48507 token_source=stdin\n')

    const handle = await handlePromise
    expect(handle.host).toBe('127.0.0.1')
    expect(handle.port).toBe(48507)
    expect(handle.baseUrl).toBe('http://127.0.0.1:48507')
    expect(handle.token).toMatch(/^[0-9a-f]{64}$/)
    expect(stdinWrites.join('')).toBe(`${handle.token}\n`)
  })

  it('rejects if the sidecar exits before the ready line', async () => {
    const spawnFn = vi.fn(() => fake as never)
    const handlePromise = spawnSidecar({
      spawnFn,
      commandResolver: () => ({ command: 'fake', args: [], env: {} }),
    })

    await Promise.resolve()
    fake.exitCode = 1
    fake.emit('exit', 1, null)

    await expect(handlePromise).rejects.toThrow(/exited with code/)
  })

  it('rejects if the ready line does not arrive within the timeout', async () => {
    vi.useFakeTimers()
    const spawnFn = vi.fn(() => fake as never)
    const handlePromise = spawnSidecar({
      spawnFn,
      readyTimeoutMs: 50,
      commandResolver: () => ({ command: 'fake', args: [], env: {} }),
    })

    // Attach the rejection assertion before advancing timers so the rejection
    // is never surfaced as "unhandled" in the test run.
    const assertion = expect(handlePromise).rejects.toThrow(/did not emit SANCTUM_READY/)
    await vi.advanceTimersByTimeAsync(60)
    await assertion
    vi.useRealTimers()
  })
})

describe('killSidecar', () => {
  it('sends SIGTERM and returns once the child exits', async () => {
    const fake = makeFakeChild()
    await killSidecar(fake as never, 1_000)
    expect(fake.killed).toBe(true)
    expect(fake.exitCode).toBe(0)
  })

  it('escalates to SIGKILL if SIGTERM does not exit within the timeout', async () => {
    vi.useFakeTimers()
    const stubborn = makeFakeChild()
    // First SIGTERM does not cause exit; override to simulate a hang.
    let sigtermCount = 0
    stubborn.kill = vi.fn((signal?: NodeJS.Signals | number) => {
      if (signal === 'SIGTERM') {
        sigtermCount += 1
        return true // do nothing — pretend it's hung
      }
      stubborn.killed = true
      queueMicrotask(() => {
        stubborn.exitCode = 137
        stubborn.emit('exit', 137, signal)
      })
      return true
    })

    const killPromise = killSidecar(stubborn as never, 100)
    await vi.advanceTimersByTimeAsync(150)
    await killPromise

    expect(sigtermCount).toBe(1)
    expect(stubborn.exitCode).toBe(137)
    vi.useRealTimers()
  })
})
