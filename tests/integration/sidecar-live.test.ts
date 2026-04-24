import { describe, expect, it } from 'vitest'
import { spawnSidecar } from '../../src/main/sidecar'

/**
 * Live integration test — spawns the actual `sanctum` CLI via the dev-mode
 * path and verifies the SANCTUM_READY handshake end-to-end. Skipped unless
 * the `sanctum` CLI is on $PATH. CI will pick this up once the Python
 * backend is bundled; locally it requires `pip install -e ..` in the
 * sibling `sanctum` repo.
 */
const skip = process.env.SANCTUM_SKIP_LIVE_TESTS === '1'

describe.skipIf(skip)('spawnSidecar live', () => {
  it('spawns the real sanctum backend, receives SANCTUM_READY, and kills it', async () => {
    const handle = await spawnSidecar({
      readyTimeoutMs: 90_000,
      commandResolver: () => ({
        command: 'sanctum',
        args: ['serve', '--port', '0', '--token-stdin'],
        env: {
          PYTHONUNBUFFERED: '1',
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
        },
      }),
    })

    try {
      expect(handle.host).toBe('127.0.0.1')
      expect(handle.port).toBeGreaterThan(0)
      expect(handle.baseUrl).toBe(`http://127.0.0.1:${String(handle.port)}`)
      expect(handle.token).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      await handle.kill()
    }

    expect(handle.child.exitCode).not.toBeNull()
  }, 120_000)
})
