/**
 * Renderer-side detection model. The shape is the projection of
 * `ReviewProposal` (sanctum/sanctum/core/models.py) onto the UI: the
 * proposal's `segment_anchor` becomes `segmentId`; `original` is paired
 * with `start`/`end` offsets within the segment text so the highlight
 * overlay (slice 4) can paint precise spans rather than whole runs;
 * the reviewer's verdict is tracked locally as `status`.
 *
 * `start` and `end` are not on `ReviewProposal` today — the backend will
 * add them when the review-session API lands (Phase 1.5 WS2). Until then
 * the renderer derives them by `indexOf(original)` inside the segment's
 * textContent. That fallback is acceptable while detections are stubbed
 * (slice 5 fake data); slice 8 / WS5 wires the real session API and
 * the offsets come from there.
 */
export type DetectionStatus = 'pending' | 'accepted' | 'rejected'

/**
 * Anonymization operator names — mirrors the backend's
 * `BUILTIN_OPERATOR_NAMES` (sanctum/anonymizer/operators.py). The UI
 * never invokes these directly; the reviewer's choice is shipped as a
 * string field of the commit payload and the backend's anonymizer
 * resolves it.
 */
export type OperatorName = 'hips' | 'replace' | 'redact' | 'mask' | 'encrypt' | 'pseudonymize'

export const OPERATOR_NAMES: readonly OperatorName[] = [
  'hips',
  'replace',
  'redact',
  'mask',
  'encrypt',
  'pseudonymize',
]

export interface Detection {
  /** Stable id; mirrors ReviewProposal.detection_id once wired. */
  readonly id: string
  /** Matches ReviewProposal.segment_anchor — see WS4-1 patch contract. */
  readonly segmentId: string
  /** Inclusive char offset within the segment's textContent. */
  readonly start: number
  /** Exclusive char offset within the segment's textContent. */
  readonly end: number
  /** PII text matched at [start, end). Renders in the tooltip. */
  readonly text: string
  /** Backend entity type (e.g. PERSON, EMAIL_ADDRESS). */
  readonly entityType: string
  /** Reviewer verdict; defaults to 'pending' when unset by the user. */
  readonly status: DetectionStatus
  /** Per-detection operator override. Falls back to session default. */
  readonly operator?: OperatorName
  /** Reviewer-provided literal replacement; wins over operator when set. */
  readonly customReplacement?: string
}
