/**
 * Wire types for the Sanctum HTTP API.
 *
 * Hand-written today (mirrors `schema/openapi.json` from the `sanctum`
 * commit pinned by this build). The atomic-installer model means the
 * desktop and the sidecar ship from the same release, so drift is a
 * tagged-release-time concern, not a runtime one. A future slice can
 * generate Zod schemas from the OpenAPI spec; until then, every PR
 * that bumps the sanctum pin updates this file.
 */

export type DocumentFormat = 'docx' | 'xlsx' | 'pdf' | 'pptx'

export type SessionStatus = 'open' | 'committed' | 'abandoned'

export interface ReviewSessionIndexEntry {
  readonly id: string
  readonly source_path: string
  readonly format: DocumentFormat
  readonly status: SessionStatus
  readonly created_at: string
  readonly committed_at: string | null
  readonly accepted_count: number
  readonly rejected_count: number
  readonly pending_count: number
}

export interface ReviewSessionListResponse {
  readonly sessions: readonly ReviewSessionIndexEntry[]
}

export interface ApiErrorBody {
  readonly error: string
  readonly details?: readonly Record<string, unknown>[] | null
}

/** Thrown by the API client; carries the HTTP status + parsed body. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody | null,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
