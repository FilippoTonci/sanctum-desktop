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

export interface TextSegment {
  readonly id: string
  readonly text: string
  readonly metadata?: Record<string, unknown>
}

export interface ReviewProposal {
  readonly detection_id: string
  readonly entity_type: string
  readonly score: number
  readonly original: string
  readonly segment_anchor: string | null
  /** Inclusive char offset within the segment's text — added in WS1.5. */
  readonly start: number
  /** Exclusive char offset within the segment's text — added in WS1.5. */
  readonly end: number
}

export type ProposalDecisionStatus = 'accept' | 'reject'

export interface ProposalDecision {
  readonly kind: 'proposal'
  readonly proposal_id: string
  readonly status: ProposalDecisionStatus
  readonly operator?: string | null
  readonly operator_params?: Record<string, unknown> | null
  readonly custom_replacement?: string | null
}

export interface UserAddedDecision {
  readonly id: string
  readonly kind: 'user_added'
  readonly segment_anchor: string
  readonly entity_type: string
  readonly original: string
  /** Char offsets within the segment's text — added in WS1.5. */
  readonly start: number
  readonly end: number
  readonly operator?: string | null
  readonly operator_params?: Record<string, unknown> | null
  readonly custom_replacement?: string | null
}

export type SessionDecision = ProposalDecision | UserAddedDecision

export interface CreateReviewSessionRequest {
  readonly input_path: string
  readonly default_operator: string
  readonly default_operator_params?: Record<string, unknown> | null
  readonly language?: string
  readonly entities?: readonly string[] | null
  readonly score_threshold?: number | null
}

export interface ReviewSessionResponse {
  readonly id: string
  readonly source_path: string
  readonly format: DocumentFormat
  readonly default_operator: string
  readonly default_operator_params: Record<string, unknown>
  readonly segments: readonly TextSegment[]
  readonly proposals: readonly ReviewProposal[]
  readonly decisions: readonly SessionDecision[]
  readonly status: SessionStatus
  readonly created_at: string
  readonly committed_at: string | null
  /** Per-detection-id preview text (slice 4 renders this as ghost text). */
  readonly previews: Record<string, string>
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
