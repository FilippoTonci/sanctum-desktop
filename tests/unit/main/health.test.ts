import { describe, expect, it, vi } from 'vitest'
import { pollHealth } from '../../../src/main/health'

function ok(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function fail(status: number): Response {
  return new Response('err', { status })
}

describe('pollHealth', () => {
  it('returns the JSON body as soon as /health returns 200', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(ok({ status: 'ok', sanctum_commit: 'abc1234' }))

    const health = await pollHealth({
      baseUrl: 'http://127.0.0.1:1234',
      token: 'tok',
      intervalMs: 1,
      timeoutMs: 5_000,
      fetchFn,
    })

    expect(health.status).toBe('ok')
    expect(health.sanctum_commit).toBe('abc1234')
    expect(fetchFn).toHaveBeenCalledTimes(2)
    const [firstCall] = fetchFn.mock.calls
    expect(firstCall?.[0]).toBe('http://127.0.0.1:1234/health')
    const headers = firstCall?.[1]?.headers
    expect(headers).toEqual({ Authorization: 'Bearer tok' })
  })

  it('rejects after timeoutMs if /health never returns 200', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(fail(503))

    await expect(
      pollHealth({
        baseUrl: 'http://127.0.0.1:1234',
        token: 'tok',
        intervalMs: 5,
        timeoutMs: 30,
        fetchFn,
      }),
    ).rejects.toThrow(/did not become ready/)
  })

  it('propagates network errors through the final rejection message', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      pollHealth({
        baseUrl: 'http://127.0.0.1:1234',
        token: 'tok',
        intervalMs: 5,
        timeoutMs: 30,
        fetchFn,
      }),
    ).rejects.toThrow(/ECONNREFUSED/)
  })
})
