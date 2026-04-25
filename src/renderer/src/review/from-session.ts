/**
 * Project a backend `ReviewSessionResponse` onto the renderer-side
 * `Detection[]` model the highlight overlay, sidebar, and tooltip
 * already consume.
 *
 * The mapping is mostly trivial because WS1.5 lined the field names up
 * with what the renderer needs:
 *
 *   ReviewProposal.detection_id   → Detection.id
 *   ReviewProposal.segment_anchor → Detection.segmentId
 *   ReviewProposal.original       → Detection.text
 *   ReviewProposal.start / .end   → Detection.start / .end (was the
 *                                    fragile indexOf fallback in WS4)
 *
 * Decisions are projected onto the proposal's `status`:
 *
 *   no decision         → 'pending'
 *   ProposalDecision    → 'accepted' / 'rejected' from .status
 *   UserAddedDecision   → produces a synthetic Detection with
 *                          id='user:<ua.id>', entityType='USER_ADDED',
 *                          status='accepted' (user-added is always an
 *                          accept by definition; see UserAddedDecision
 *                          docstring in sanctum/core/models.py)
 *
 * Custom replacement and operator overrides are not surfaced here yet —
 * slice 3 (decision sync) lifts them onto the Detection so the
 * tooltip's existing operator-picker / replacement-editor can read
 * the server-of-record state.
 */

import type { ReviewSessionResponse, ProposalDecision, UserAddedDecision } from '../api/types'
import { OPERATOR_NAMES, type Detection, type OperatorName } from './types'

export function sessionToDetections(session: ReviewSessionResponse): Detection[] {
  // Index decisions by what they reference so we don't re-scan per
  // proposal. ProposalDecisions key by proposal_id; UserAddedDecisions
  // get their own pass.
  const proposalDecisions = new Map<string, ProposalDecision>()
  const userAdded: UserAddedDecision[] = []
  for (const d of session.decisions) {
    if (d.kind === 'proposal') {
      proposalDecisions.set(d.proposal_id, d)
    } else {
      userAdded.push(d)
    }
  }

  const out: Detection[] = []

  for (const p of session.proposals) {
    if (p.segment_anchor === null) continue
    const decision = proposalDecisions.get(p.detection_id)
    out.push({
      id: p.detection_id,
      segmentId: p.segment_anchor,
      start: p.start,
      end: p.end,
      text: p.original,
      entityType: p.entity_type,
      status: decision === undefined ? 'pending' : decisionStatus(decision.status),
      operator: knownOperator(decision?.operator),
      customReplacement: nullableToOptional(decision?.custom_replacement),
    })
  }

  for (const ua of userAdded) {
    out.push({
      id: `user:${ua.id}`,
      segmentId: ua.segment_anchor,
      start: ua.start,
      end: ua.end,
      text: ua.original,
      entityType: 'USER_ADDED',
      status: 'accepted',
      operator: knownOperator(ua.operator),
      customReplacement: nullableToOptional(ua.custom_replacement),
    })
  }

  return out
}

function decisionStatus(status: 'accept' | 'reject'): 'accepted' | 'rejected' {
  return status === 'accept' ? 'accepted' : 'rejected'
}

/**
 * The wire types use `null` to indicate "field not set"; the renderer
 * Detection uses `undefined` for the same. Bridge them explicitly so
 * `Detection.operator === undefined` consistently means "fall back to
 * the session default", matching what tooltip / commit-panel already
 * assume.
 */
function nullableToOptional<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value
}

/**
 * Narrow a wire-typed operator string to the union the UI knows. An
 * unknown operator (future backend addition that this build hasn't
 * caught up to) drops back to `undefined` so the tooltip's session-
 * default fallback kicks in instead of crashing the picker.
 */
function knownOperator(value: string | null | undefined): OperatorName | undefined {
  if (value === null || value === undefined) return undefined
  return (OPERATOR_NAMES as readonly string[]).includes(value) ? (value as OperatorName) : undefined
}
