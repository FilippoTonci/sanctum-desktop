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
  /**
   * Paragraph key (engine Ruling 14): segments sharing a block are joined
   * in order, with `join_before` between them, for detection and the leak
   * check. `null` = the segment stands alone. Optional for older engines.
   */
  readonly block?: string | null
  /** Text placed between the previous segment of the block and this one. */
  readonly join_before?: string
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
  /**
   * Linked finding (E6): pieces of one name split across runs or lines
   * share a group id. `null`/absent for a single-piece finding.
   */
  readonly group_id?: string | null
  /** 0 for the head piece, which carries the replacement preview. */
  readonly group_index?: number
  /** The whole finding's text; `null` for a single-piece finding. */
  readonly group_original?: string | null
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

export interface PatchProposalDecisionRequest {
  readonly status: ProposalDecisionStatus
  readonly operator?: string | null
  readonly operator_params?: Record<string, unknown> | null
  readonly custom_replacement?: string | null
}

export interface AddUserAddedDecisionRequest {
  readonly segment_anchor: string
  readonly entity_type: string
  readonly original: string
  readonly start: number
  readonly end: number
  readonly operator?: string | null
  readonly operator_params?: Record<string, unknown> | null
  readonly custom_replacement?: string | null
}

export interface DecisionWithPreviewResponse {
  readonly decision: SessionDecision
  readonly preview: string
  /**
   * Detection ids the backend dropped because the user-added span
   * overlapped them (sanctum#31). Non-empty only on POST user-added
   * when the new span ate at least one model proposal; empty for PATCH
   * and for non-overlapping spans. Older backends that predate the
   * field are read as `[]` since the property is optional on the wire.
   */
  readonly removed_proposal_ids?: readonly string[]
}

export interface CommitReviewSessionRequest {
  /** Server-readable absolute path the anonymized document gets written to. */
  readonly output_path: string
  /** Hard gate — the API refuses to commit unless the caller asserts true. */
  readonly attested: boolean
}

export interface CommitReviewSessionResponse {
  readonly session_id: string
  readonly output_path: string
  readonly committed_at: string
}

export interface UnlockMappingRequest {
  readonly store_path: string
  readonly passphrase: string
}

export interface UnlockMappingResponse {
  readonly unlocked: true
  readonly store_path: string
}

export interface LockMappingResponse {
  readonly unlocked: false
  readonly store_path: string | null
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

/*
 * Review-surface layout — `GET /review-sessions/{id}/layout` (the engine's
 * shared pptx/pdf layout contract).
 * Points (1/72 in), top-left origin, items in paint order. Fields marked
 * "addition" are optional extensions the pptx prototype introduced.
 */

export interface LayoutRun {
  readonly segment_id: string
  readonly text: string
  readonly size: number
  readonly bold?: boolean
  readonly italic?: boolean
  readonly color?: string | null
  readonly font?: string | null
}

export type LayoutAlign = 'left' | 'center' | 'right' | 'justify'

export interface LayoutParagraph {
  readonly align?: LayoutAlign
  readonly runs: readonly LayoutRun[]
}

interface LayoutBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface LayoutTextboxItem extends LayoutBox {
  readonly kind: 'textbox'
  readonly paragraphs: readonly LayoutParagraph[]
  /** addition: vertical anchor of the text frame. */
  readonly anchor?: 'top' | 'middle' | 'bottom'
}

export interface LayoutTextlineItem extends LayoutBox {
  readonly kind: 'textline'
  readonly segment_id: string
  readonly text: string
  readonly size: number
  /** addition: PDF base font name. Optional — the engine does not send it. */
  readonly font?: string | null
}

export interface LayoutImageItem extends LayoutBox {
  readonly kind: 'image'
  /** data: URI, or null when the format can't be shown in a browser. */
  readonly src: string | null
  /** addition: picture alt-text segment. */
  readonly alt?: { readonly segment_id: string; readonly text: string } | null
}

export interface LayoutShapeItem extends LayoutBox {
  readonly kind: 'shape'
  readonly fill: string | null
}

export type LayoutItem = LayoutTextboxItem | LayoutTextlineItem | LayoutImageItem | LayoutShapeItem

export interface LayoutPage {
  readonly index: number
  readonly width: number
  readonly height: number
  readonly items: readonly LayoutItem[]
  /** addition: speaker notes (pptx). */
  readonly notes?: readonly LayoutParagraph[] | null
}

export interface LayoutUnscanned {
  readonly where: string
  readonly what: string
  /** addition: 0-based page index, null for document-level entries. */
  readonly page?: number | null
}

export interface ReviewSessionLayout {
  readonly format: 'pptx' | 'pdf'
  readonly pages: readonly LayoutPage[]
  readonly unscanned?: readonly LayoutUnscanned[]
}

/** Wire name of the engine's response model; same shape. */
export type ReviewSessionLayoutResponse = ReviewSessionLayout

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
