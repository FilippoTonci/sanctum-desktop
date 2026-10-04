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
  /**
   * Linked finding: a name split across Word runs or PDF lines arrives as
   * several pieces sharing a group id. Unset for a single-piece finding.
   */
  readonly groupId?: string
  /** Position within the group; the lowest present index is the head. */
  readonly groupIndex?: number
  /** The whole finding's text ("Jennifer Martin"), shown in place of `text`. */
  readonly groupText?: string
}

/**
 * The piece that stands for a linked finding in lists, counts, focus and
 * engine requests: the member with the lowest `groupIndex` (the engine
 * renumbers so this is 0, but a locally pruned group may briefly lack it).
 * A detection with no group is its own head. `undefined` for an unknown id.
 */
export function headOf(detections: readonly Detection[], id: string): Detection | undefined {
  const target = detections.find((d) => d.id === id)
  if (target?.groupId === undefined) return target
  let head = target
  for (const d of detections) {
    if (d.groupId === target.groupId && (d.groupIndex ?? 0) < (head.groupIndex ?? 0)) head = d
  }
  return head
}

/** Every piece of `id`'s finding, in list order; just itself when ungrouped. */
export function membersOf(detections: readonly Detection[], id: string): Detection[] {
  const target = detections.find((d) => d.id === id)
  if (target === undefined) return []
  if (target.groupId === undefined) return [target]
  return detections.filter((d) => d.groupId === target.groupId)
}

/** Whether `detection` is the head of its finding (always true when ungrouped). */
export function isHead(detections: readonly Detection[], detection: Detection): boolean {
  if (detection.groupId === undefined) return true
  return headOf(detections, detection.id)?.id === detection.id
}

/** One detection per finding — the heads — in list order. */
export function headsOf(detections: readonly Detection[]): Detection[] {
  const heads = new Map<string, Detection>()
  for (const d of detections) {
    if (d.groupId === undefined) continue
    const current = heads.get(d.groupId)
    if (current === undefined || (d.groupIndex ?? 0) < (current.groupIndex ?? 0)) {
      heads.set(d.groupId, d)
    }
  }
  return detections.filter((d) => d.groupId === undefined || heads.get(d.groupId) === d)
}

/** The text a finding is listed under: the whole group's text, or its own. */
export function findingText(detection: Detection): string {
  return detection.groupText ?? detection.text
}
