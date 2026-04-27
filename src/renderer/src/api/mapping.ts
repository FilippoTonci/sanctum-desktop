/**
 * HTTP client for the `/mapping/*` family — the encrypted pseudonymize
 * mapping store. Slice 6 wires unlock + lock; future slices may grow
 * `/mapping/reverse` (un-anonymize a pseudonym) and `/mapping/rotate-key`
 * (re-encrypt under a new passphrase).
 *
 * Same factory pattern as the sessions client — components hold a
 * client instance built once per ready-status round-trip.
 */

import {
  ApiError,
  type ApiErrorBody,
  type LockMappingResponse,
  type UnlockMappingRequest,
  type UnlockMappingResponse,
} from './types'

export interface MappingClient {
  unlock(body: UnlockMappingRequest, signal?: AbortSignal): Promise<UnlockMappingResponse>
  lock(signal?: AbortSignal): Promise<LockMappingResponse>
}

interface ClientOptions {
  readonly baseUrl: string
  readonly token: string
  readonly fetchImpl?: typeof fetch
}

export function createMappingClient(opts: ClientOptions): MappingClient {
  const fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis)

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${opts.token}`,
    Accept: 'application/json',
  })

  const url = (path: string): string => {
    const base = opts.baseUrl.endsWith('/') ? opts.baseUrl.slice(0, -1) : opts.baseUrl
    return `${base}${path}`
  }

  const handle = async (response: Response): Promise<unknown> => {
    if (response.ok) return response.json()
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // body wasn't JSON — leave as null and surface the status alone.
    }
    const errorBody =
      body !== null && typeof body === 'object' && 'error' in body ? (body as ApiErrorBody) : null
    const message =
      errorBody !== null
        ? errorBody.error
        : `HTTP ${String(response.status)} ${response.statusText}`
    throw new ApiError(response.status, errorBody, message)
  }

  return {
    async unlock(body, signal) {
      const response = await fetchImpl(url('/mapping/unlock'), {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      return (await handle(response)) as UnlockMappingResponse
    },

    async lock(signal) {
      const response = await fetchImpl(url('/mapping/lock'), {
        method: 'POST',
        headers: headers(),
        signal,
      })
      return (await handle(response)) as LockMappingResponse
    },
  }
}

export function mappingClientFromCredentials(
  credentials: { readonly baseUrl: string; readonly token: string } | null,
): MappingClient | null {
  if (credentials === null) return null
  if (credentials.baseUrl === '' || credentials.token === '') return null
  return createMappingClient(credentials)
}
