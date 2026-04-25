/**
 * Renderer-side detection model. The shape is the projection of
 * `ReviewProposal` + `UserAddedDecision` (sanctum/sanctum/core/models.py)
 * onto the UI: `segment_anchor` becomes `segmentId`; `original` becomes
 * `text`; backend `start` / `end` offsets (added in WS1.5) come through
 * verbatim so the highlight overlay can paint precise spans without
 * `str.find` ambiguity; the reviewer's verdict is tracked as `status`.
 *
 * Built from a session response by `review/from-session.ts` in the WS5
 * wire-up; built from regex matches by `review/fake-detections.ts` in
 * the standalone-browser fallback.
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
