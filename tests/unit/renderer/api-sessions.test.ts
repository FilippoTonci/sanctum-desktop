// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { clientFromCredentials, createSessionsClient } from '../../../src/renderer/src/api/sessions'
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

describe('createSessionsClient.listSessions', () => {
  it('GETs /review-sessions with the bearer token', async () => {
    const fetchImpl = vi.fn((input: Request | string | URL, init?: RequestInit) => {
      expect(urlOf(input)).toBe('http://127.0.0.1:9000/review-sessions')
      expect(init?.method).toBe('GET')
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer abc123')
      expect(headers.Accept).toBe('application/json')
      return Promise.resolve(jsonResponse(200, { sessions: [] }))
    })
    const client = createSessionsClient({
      baseUrl: 'http://127.0.0.1:9000',
      token: 'abc123',
      fetchImpl,
    })
    const out = await client.listSessions()
    expect(out).toEqual({ sessions: [] })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('strips a trailing slash from baseUrl', async () => {
    const fetchImpl = vi.fn((input: Request | string | URL) => {
      expect(urlOf(input)).toBe('http://127.0.0.1:9000/review-sessions')
      return Promise.resolve(jsonResponse(200, { sessions: [] }))
    })
    const client = createSessionsClient({
      baseUrl: 'http://127.0.0.1:9000/',
      token: 't',
      fetchImpl,
    })
    await client.listSessions()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('parses JSON sessions and preserves the wire shape', async () => {
    const session = {
      id: 'sess-1',
      source_path: '/tmp/contract.docx',
      format: 'docx',
      status: 'open',
      created_at: '2026-04-25T09:00:00Z',
      committed_at: null,
      accepted_count: 2,
      rejected_count: 1,
      pending_count: 4,
    }
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(200, { sessions: [session] })))
    const client = createSessionsClient({
      baseUrl: 'http://127.0.0.1:9000',
      token: 't',
      fetchImpl,
    })
    const out = await client.listSessions()
    expect(out.sessions).toHaveLength(1)
    expect(out.sessions[0]).toEqual(session)
  })

  it('throws ApiError carrying status + body on 4xx', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(401, { error: 'unauthorized' })))
    const client = createSessionsClient({
      baseUrl: 'http://127.0.0.1:9000',
      token: 'bad',
      fetchImpl,
    })
    await expect(client.listSessions()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'unauthorized',
    })
    await expect(client.listSessions()).rejects.toBeInstanceOf(ApiError)
  })

  it('throws ApiError on 5xx with empty body when JSON parse fails', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('not json', { status: 503 })))
    const client = createSessionsClient({
      baseUrl: 'http://127.0.0.1:9000',
      token: 't',
      fetchImpl,
    })
    await expect(client.listSessions()).rejects.toMatchObject({
      status: 503,
      body: null,
    })
  })

  it('forwards the AbortSignal so callers can cancel mid-flight', async () => {
    const fetchImpl = vi.fn((_input: Request | string | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return Promise.resolve(jsonResponse(200, { sessions: [] }))
    })
    const client = createSessionsClient({
      baseUrl: 'http://127.0.0.1:9000',
      token: 't',
      fetchImpl,
    })
    const ctrl = new AbortController()
    await client.listSessions(ctrl.signal)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

describe('createSessionsClient.createSession', () => {
  it('POSTs the request body as JSON with the bearer token', async () => {
    const fetchImpl = vi.fn((input: Request | string | URL, init?: RequestInit) => {
      expect(urlOf(input)).toBe('http://127.0.0.1:9000/review-sessions')
      expect(init?.method).toBe('POST')
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer t')
      expect(headers['Content-Type']).toBe('application/json')
      const rawBody = init?.body
      expect(typeof rawBody).toBe('string')
      expect(JSON.parse(rawBody as string)).toEqual({
        input_path: '/tmp/x.docx',
        default_operator: 'hips',
      })
      return Promise.resolve(
        jsonResponse(201, {
          id: 'sess-1',
          source_path: '/tmp/x.docx',
          format: 'docx',
          default_operator: 'hips',
          default_operator_params: {},
          segments: [],
          proposals: [],
          decisions: [],
          status: 'open',
          created_at: '2026-04-25T12:00:00Z',
          committed_at: null,
          previews: {},
        }),
      )
    })
    const client = createSessionsClient({
      baseUrl: 'http://127.0.0.1:9000',
      token: 't',
      fetchImpl,
    })
    const out = await client.createSession({
      input_path: '/tmp/x.docx',
      default_operator: 'hips',
    })
    expect(out.id).toBe('sess-1')
  })

  it('throws ApiError on a 400 with a parsed validation body', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(400, { error: 'input_path: file does not exist' })),
    )
    const client = createSessionsClient({
      baseUrl: 'http://127.0.0.1:9000',
      token: 't',
      fetchImpl,
    })
    await expect(
      client.createSession({ input_path: '/missing', default_operator: 'hips' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'input_path: file does not exist',
    })
  })
})

describe('createSessionsClient.getSession', () => {
  it('GETs /review-sessions/{id} and url-encodes the id', async () => {
    const fetchImpl = vi.fn((input: Request | string | URL) => {
      expect(urlOf(input)).toBe('http://127.0.0.1:9000/review-sessions/sess%2Fweird%20id')
      return Promise.resolve(
        jsonResponse(200, {
          id: 'sess/weird id',
          source_path: '/tmp/x.docx',
          format: 'docx',
          default_operator: 'hips',
          default_operator_params: {},
          segments: [],
          proposals: [],
          decisions: [],
          status: 'open',
          created_at: '2026-04-25T12:00:00Z',
          committed_at: null,
          previews: {},
        }),
      )
    })
    const client = createSessionsClient({
      baseUrl: 'http://127.0.0.1:9000',
      token: 't',
      fetchImpl,
    })
    const out = await client.getSession('sess/weird id')
    expect(out.id).toBe('sess/weird id')
  })
})

describe('clientFromCredentials', () => {
  it('returns null for null credentials', () => {
    expect(clientFromCredentials(null)).toBeNull()
  })

  it('returns null for placeholder strings (standalone Vite mode)', () => {
    expect(clientFromCredentials({ baseUrl: '', token: '' })).toBeNull()
    expect(clientFromCredentials({ baseUrl: '', token: 't' })).toBeNull()
    expect(clientFromCredentials({ baseUrl: 'x', token: '' })).toBeNull()
  })

  it('returns a client when both credentials are non-empty', () => {
    const client = clientFromCredentials({
      baseUrl: 'http://127.0.0.1:9000',
      token: 't',
    })
    expect(client).not.toBeNull()
    expect(typeof client?.listSessions).toBe('function')
  })
})
