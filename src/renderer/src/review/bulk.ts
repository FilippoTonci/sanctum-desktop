import type { ReviewActions } from './actions'
import { headsOf, type Detection, type DetectionStatus } from './types'

/**
 * Ids of findings of `entityType`, optionally narrowed to one status. A
 * linked finding contributes its head only.
 */
export function idsOfType(
  detections: readonly Detection[],
  entityType: string,
  status?: DetectionStatus,
): string[] {
  return headsOf(detections)
    .filter((d) => d.entityType === entityType && (status === undefined || d.status === status))
    .map((d) => d.id)
}

/**
 * Apply one verdict to every still-pending detection of a type — the
 * "redact all Person" bulk action. Decided rows are left alone so a
 * bulk pass never overrides a choice the reviewer made by hand. Each id
 * lands as its own undo entry, so Cmd+Z steps back one row at a time.
 * Linked findings are decided through their head; the engine (and the
 * store) carry the verdict to every piece.
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

/** Counts per finding: a linked finding counts once, by its head. */
export function countDetections(all: readonly Detection[]): ReviewCounts {
  const detections = headsOf(all)
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
