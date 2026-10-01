import type { ReviewActions } from './actions'
import type { Detection, DetectionStatus } from './types'

/** Ids of detections of `entityType`, optionally narrowed to one status. */
export function idsOfType(
  detections: readonly Detection[],
  entityType: string,
  status?: DetectionStatus,
): string[] {
  return detections
    .filter((d) => d.entityType === entityType && (status === undefined || d.status === status))
    .map((d) => d.id)
}

/**
 * Apply one verdict to every still-pending detection of a type — the
 * "redact all Person" bulk action. Decided rows are left alone so a
 * bulk pass never overrides a choice the reviewer made by hand. Each id
 * lands as its own undo entry, so Cmd+Z steps back one row at a time.
 * Returns how many rows changed.
 */
export function decideAllPendingOfType(
  detections: readonly Detection[],
  entityType: string,
  verdict: 'accept' | 'reject',
  actions: ReviewActions,
): number {
  const ids = idsOfType(detections, entityType, 'pending')
  for (const id of ids) {
    if (verdict === 'accept') actions.accept(id)
    else actions.reject(id)
  }
  return ids.length
}

export interface ReviewCounts {
  readonly total: number
  readonly pending: number
  readonly accepted: number
  readonly rejected: number
  readonly reviewed: number
}

export function countDetections(detections: readonly Detection[]): ReviewCounts {
  let pending = 0
  let accepted = 0
  let rejected = 0
  for (const d of detections) {
    if (d.status === 'pending') pending++
    else if (d.status === 'accepted') accepted++
    else rejected++
  }
  return {
    total: detections.length,
    pending,
    accepted,
    rejected,
    reviewed: accepted + rejected,
  }
}
