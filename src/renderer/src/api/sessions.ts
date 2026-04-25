/**
 * HTTP client for the `/review-sessions` family of endpoints.
 *
 * One factory `createSessionsClient(baseUrl, token)` returns an object
 * holding every relevant verb. Components import a singleton built from
 * `window.sanctum` (when present) or import the factory directly when
 * they need a custom client (tests, future plugin contexts).
 *
 * Error policy:
 *
 * - Network failures and 5xx → throw `ApiError` with the parsed body.
 * - 4xx → throw `ApiError` so callers can `instanceof` and route to
 *   the matching error component (slice 8).
 * - 2xx → return the typed body verbatim.
 *
 * No automatic retries. Cold-start session creation (POST) can take
 * 30+ seconds because Presidio is loading; surfacing that as a slow
 * `await` is correct, and the splash + spinner UI handles it.
 */

import { ApiError, type ApiErrorBody, type ReviewSessionListResponse } from './types'

export interface SessionsClient {
  listSessions(signal?: AbortSignal): Promise<ReviewSessionListResponse>
}

interface ClientOptions {
  readonly baseUrl: string
  readonly token: string
  readonly fetchImpl?: typeof fetch
}

export function createSessionsClient(opts: ClientOptions): SessionsClient {
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
    async listSessions(signal) {
      const response = await fetchImpl(url('/review-sessions'), {
        method: 'GET',
        headers: headers(),
        signal,
      })
      return (await handle(response)) as ReviewSessionListResponse
    },
  }
}

/**
 * Build a client from a SanctumStatus. Returns `null` when the backend
 * isn't ready yet, the credentials are placeholder strings (standalone
 * Vite dev mode), or any other non-ready status — components handle the
 * null by showing an empty state rather than throwing.
 */
export function clientFromCredentials(
  credentials: { readonly baseUrl: string; readonly token: string } | null,
): SessionsClient | null {
  if (credentials === null) return null
  if (credentials.baseUrl === '' || credentials.token === '') return null
  return createSessionsClient(credentials)
}
