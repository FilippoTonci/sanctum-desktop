// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import {
  createMappingClient,
  mappingClientFromCredentials,
} from '../../../src/renderer/src/api/mapping'
import { ApiError } from '../../../src/renderer/src/api/types'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function urlOf(input: Request | string | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

describe('createMappingClient.unlock', () => {
  it('POSTs the request body and returns the typed response', async () => {
    const fetchImpl = vi.fn((input: Request | string | URL, init?: RequestInit) => {
      expect(urlOf(input)).toBe('http://127.0.0.1:9000/mapping/unlock')
      expect(init?.method).toBe('POST')
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer t')
      expect(headers['Content-Type']).toBe('application/json')
      return Promise.resolve(
        jsonResponse(200, { unlocked: true, store_path: '/home/u/.sanctum/mapping-store.bin' }),
      )
    })
    const client = createMappingClient({
      baseUrl: 'http://127.0.0.1:9000',
      token: 't',
      fetchImpl,
    })
    const out = await client.unlock({
      store_path: '/home/u/.sanctum/mapping-store.bin',
      passphrase: 'correct horse battery staple',
    })
    expect(out.unlocked).toBe(true)
  })

  it('throws ApiError on a 401 (wrong passphrase)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(401, { error: 'invalid passphrase' })),
    )
    const client = createMappingClient({
      baseUrl: 'http://127.0.0.1:9000',
      token: 't',
      fetchImpl,
    })
    await expect(client.unlock({ store_path: '/x.bin', passphrase: 'nope' })).rejects.toMatchObject(
      { status: 401, message: 'invalid passphrase' },
    )
    await expect(
      client.unlock({ store_path: '/x.bin', passphrase: 'nope' }),
    ).rejects.toBeInstanceOf(ApiError)
  })
})

describe('createMappingClient.lock', () => {
  it('POSTs (no body) and returns the locked response', async () => {
    const fetchImpl = vi.fn((input: Request | string | URL, init?: RequestInit) => {
      expect(urlOf(input)).toBe('http://127.0.0.1:9000/mapping/lock')
      expect(init?.method).toBe('POST')
      return Promise.resolve(
        jsonResponse(200, { unlocked: false, store_path: '/home/u/.sanctum/mapping-store.bin' }),
      )
    })
    const client = createMappingClient({
      baseUrl: 'http://127.0.0.1:9000',
      token: 't',
      fetchImpl,
    })
    const out = await client.lock()
    expect(out.unlocked).toBe(false)
  })

  it('returns store_path=null when /lock was a no-op (nothing was unlocked)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { unlocked: false, store_path: null })),
    )
    const client = createMappingClient({
      baseUrl: 'http://127.0.0.1:9000',
      token: 't',
      fetchImpl,
    })
    const out = await client.lock()
    expect(out.store_path).toBeNull()
  })
})

describe('mappingClientFromCredentials', () => {
  it('returns null for null / placeholder credentials (standalone Vite mode)', () => {
    expect(mappingClientFromCredentials(null)).toBeNull()
    expect(mappingClientFromCredentials({ baseUrl: '', token: '' })).toBeNull()
    expect(mappingClientFromCredentials({ baseUrl: 'x', token: '' })).toBeNull()
  })

  it('returns a client when both credentials are non-empty', () => {
    const client = mappingClientFromCredentials({
      baseUrl: 'http://127.0.0.1:9000',
      token: 't',
    })
    expect(client).not.toBeNull()
    expect(typeof client?.unlock).toBe('function')
    expect(typeof client?.lock).toBe('function')
  })
})
