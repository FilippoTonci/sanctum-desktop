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

import {
  ApiError,
  type AddUserAddedDecisionRequest,
  type ApiErrorBody,
  type CommitReviewSessionRequest,
  type CommitReviewSessionResponse,
  type CreateReviewSessionRequest,
  type DecisionWithPreviewResponse,
  type PatchProposalDecisionRequest,
  type ReviewSessionListResponse,
  type ReviewSessionResponse,
} from './types'

export interface SessionsClient {
  listSessions(signal?: AbortSignal): Promise<ReviewSessionListResponse>
  createSession(
    body: CreateReviewSessionRequest,
    signal?: AbortSignal,
  ): Promise<ReviewSessionResponse>
  getSession(id: string, signal?: AbortSignal): Promise<ReviewSessionResponse>
  /**
   * Fetch the original input bytes pinned for an OPEN session. The
   * desktop's "resume from Recent Sessions" flow feeds the returned
   * Blob into docx-preview; the on-disk source path is not required.
   * Throws ApiError(410) for terminal sessions (committed / abandoned)
   * — those have shed their input bytes by design.
   */
  getSessionInput(id: string, signal?: AbortSignal): Promise<Blob>
  patchDecision(
    sessionId: string,
    proposalId: string,
    body: PatchProposalDecisionRequest,
    signal?: AbortSignal,
  ): Promise<DecisionWithPreviewResponse>
  addUserAdded(
    sessionId: string,
    body: AddUserAddedDecisionRequest,
    signal?: AbortSignal,
  ): Promise<DecisionWithPreviewResponse>
  deleteUserAdded(sessionId: string, uaId: string, signal?: AbortSignal): Promise<void>
  commitSession(
    sessionId: string,
    body: CommitReviewSessionRequest,
    signal?: AbortSignal,
  ): Promise<CommitReviewSessionResponse>
  abandonSession(sessionId: string, signal?: AbortSignal): Promise<void>
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

    async createSession(body, signal) {
      const response = await fetchImpl(url('/review-sessions'), {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      return (await handle(response)) as ReviewSessionResponse
    },

    async getSession(id, signal) {
      const response = await fetchImpl(url(`/review-sessions/${encodeURIComponent(id)}`), {
        method: 'GET',
        headers: headers(),
        signal,
      })
      return (await handle(response)) as ReviewSessionResponse
    },

    async getSessionInput(id, signal) {
      // Override the default Accept since this endpoint returns the
      // session's source-document bytes, not JSON. The 4xx/5xx error
      // bodies are still JSON, so `handle()` is reused for fail-paths
      // and the success branch reads the response as a Blob.
      const response = await fetchImpl(url(`/review-sessions/${encodeURIComponent(id)}/input`), {
        method: 'GET',
        headers: { Authorization: `Bearer ${opts.token}` },
        signal,
      })
      if (!response.ok) {
        await handle(response)
        // handle() always throws on a non-ok response. The throw above
        // is never seen by the caller; this line is purely for the
        // type-checker since `handle()` is typed as Promise<unknown>.
        throw new Error('unreachable')
      }
      return response.blob()
    },

    async patchDecision(sessionId, proposalId, body, signal) {
      const response = await fetchImpl(
        url(
          `/review-sessions/${encodeURIComponent(sessionId)}/decisions/${encodeURIComponent(proposalId)}`,
        ),
        {
          method: 'PATCH',
          headers: { ...headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        },
      )
      return (await handle(response)) as DecisionWithPreviewResponse
    },

    async addUserAdded(sessionId, body, signal) {
      const response = await fetchImpl(
        url(`/review-sessions/${encodeURIComponent(sessionId)}/decisions/user-added`),
        {
          method: 'POST',
          headers: { ...headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        },
      )
      return (await handle(response)) as DecisionWithPreviewResponse
    },

    async deleteUserAdded(sessionId, uaId, signal) {
      const response = await fetchImpl(
        url(
          `/review-sessions/${encodeURIComponent(sessionId)}/decisions/user-added/${encodeURIComponent(uaId)}`,
        ),
        {
          method: 'DELETE',
          headers: headers(),
          signal,
        },
      )
      if (!response.ok) {
        // 204 returns ok=true; only fail-paths reach here.
        await handle(response)
      }
    },

    async commitSession(sessionId, body, signal) {
      const response = await fetchImpl(
        url(`/review-sessions/${encodeURIComponent(sessionId)}/commit`),
        {
          method: 'POST',
          headers: { ...headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        },
      )
      return (await handle(response)) as CommitReviewSessionResponse
    },

    async abandonSession(sessionId, signal) {
      const response = await fetchImpl(url(`/review-sessions/${encodeURIComponent(sessionId)}`), {
        method: 'DELETE',
        headers: headers(),
        signal,
      })
      if (!response.ok) {
        await handle(response)
      }
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
