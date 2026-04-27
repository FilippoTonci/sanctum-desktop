// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import {
  previewsForStore,
  sessionToDetections,
} from '../../../src/renderer/src/review/from-session'
import type { ReviewSessionResponse } from '../../../src/renderer/src/api/types'

function makeSession(overrides: Partial<ReviewSessionResponse> = {}): ReviewSessionResponse {
  return {
    id: 'sess-1',
    source_path: '/tmp/contract.docx',
    format: 'docx',
    default_operator: 'hips',
    default_operator_params: {},
    segments: [],
    proposals: [],
    decisions: [],
    status: 'open',
    created_at: '2026-04-25T12:00:00Z',
    committed_at: null,
    previews: {},
    ...overrides,
  }
}

describe('sessionToDetections', () => {
  it('maps a proposal with no decision to a pending Detection', () => {
    const out = sessionToDetections(
      makeSession({
        proposals: [
          {
            detection_id: 'det-1',
            entity_type: 'PERSON',
            score: 0.95,
            original: 'Rachel Moore',
            segment_anchor: 'body/p4/r0',
            start: 9,
            end: 21,
          },
        ],
      }),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      id: 'det-1',
      segmentId: 'body/p4/r0',
      start: 9,
      end: 21,
      text: 'Rachel Moore',
      entityType: 'PERSON',
      status: 'pending',
      operator: undefined,
      customReplacement: undefined,
    })
  })

  it('projects a ProposalDecision onto the matching proposal', () => {
    const out = sessionToDetections(
      makeSession({
        proposals: [
          {
            detection_id: 'det-1',
            entity_type: 'PERSON',
            score: 0.9,
            original: 'Alice',
            segment_anchor: 'body/p0/r0',
            start: 0,
            end: 5,
          },
          {
            detection_id: 'det-2',
            entity_type: 'PERSON',
            score: 0.9,
            original: 'Bob',
            segment_anchor: 'body/p0/r0',
            start: 6,
            end: 9,
          },
        ],
        decisions: [
          { kind: 'proposal', proposal_id: 'det-1', status: 'accept', operator: 'mask' },
          {
            kind: 'proposal',
            proposal_id: 'det-2',
            status: 'reject',
            custom_replacement: null,
          },
        ],
      }),
    )
    expect(out[0]?.status).toBe('accepted')
    expect(out[0]?.operator).toBe('mask')
    expect(out[1]?.status).toBe('rejected')
  })

  it('appends a USER_ADDED Detection per UserAddedDecision', () => {
    const out = sessionToDetections(
      makeSession({
        decisions: [
          {
            kind: 'user_added',
            id: 'ua-1',
            segment_anchor: 'body/p4/r0',
            entity_type: 'PERSON',
            original: 'Smith',
            start: 0,
            end: 5,
          },
        ],
      }),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      id: 'user:ua-1',
      segmentId: 'body/p4/r0',
      start: 0,
      end: 5,
      text: 'Smith',
      entityType: 'USER_ADDED',
      status: 'accepted',
      operator: undefined,
      customReplacement: undefined,
    })
  })

  it('drops proposals with a null segment_anchor — UI cannot place them', () => {
    const out = sessionToDetections(
      makeSession({
        proposals: [
          {
            detection_id: 'det-1',
            entity_type: 'PERSON',
            score: 0.9,
            original: 'Alice',
            segment_anchor: null,
            start: 0,
            end: 5,
          },
        ],
      }),
    )
    expect(out).toEqual([])
  })

  it('preserves proposal order, then user-added in their own order', () => {
    const out = sessionToDetections(
      makeSession({
        proposals: [
          {
            detection_id: 'p2',
            entity_type: 'X',
            score: 1,
            original: 'p2',
            segment_anchor: 's',
            start: 0,
            end: 2,
          },
          {
            detection_id: 'p1',
            entity_type: 'X',
            score: 1,
            original: 'p1',
            segment_anchor: 's',
            start: 3,
            end: 5,
          },
        ],
        decisions: [
          {
            kind: 'user_added',
            id: 'u-z',
            segment_anchor: 's',
            entity_type: 'X',
            original: 'z',
            start: 6,
            end: 7,
          },
          {
            kind: 'user_added',
            id: 'u-a',
            segment_anchor: 's',
            entity_type: 'X',
            original: 'a',
            start: 8,
            end: 9,
          },
        ],
      }),
    )
    expect(out.map((d) => d.id)).toEqual(['p2', 'p1', 'user:u-z', 'user:u-a'])
  })
})

describe('previewsForStore', () => {
  it('keys proposal previews by detection_id verbatim', () => {
    const out = previewsForStore(
      makeSession({
        proposals: [
          {
            detection_id: 'det-1',
            entity_type: 'PERSON',
            score: 1,
            original: 'Alice',
            segment_anchor: 's',
            start: 0,
            end: 5,
          },
        ],
        previews: { 'det-1': '<PERSON>' },
      }),
    )
    expect(out).toEqual({ 'det-1': '<PERSON>' })
  })

  it('prefixes user-added preview keys with user: to match Detection.id', () => {
    const out = previewsForStore(
      makeSession({
        decisions: [
          {
            kind: 'user_added',
            id: 'ua-uuid',
            segment_anchor: 's',
            entity_type: 'PERSON',
            original: 'Smith',
            start: 0,
            end: 5,
          },
        ],
        previews: { 'ua-uuid': '[CUSTOM]' },
      }),
    )
    expect(out).toEqual({ 'user:ua-uuid': '[CUSTOM]' })
  })

  it('skips proposals + user-added without a preview entry', () => {
    const out = previewsForStore(
      makeSession({
        proposals: [
          {
            detection_id: 'det-1',
            entity_type: 'X',
            score: 1,
            original: 'a',
            segment_anchor: 's',
            start: 0,
            end: 1,
          },
        ],
        previews: {},
      }),
    )
    expect(out).toEqual({})
  })
})
