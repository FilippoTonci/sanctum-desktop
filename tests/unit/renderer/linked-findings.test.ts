// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionsClient } from '../../../src/renderer/src/api/sessions'
import type { ReviewProposal, ReviewSessionResponse } from '../../../src/renderer/src/api/types'
import { syncedActions } from '../../../src/renderer/src/review/actions'
import {
  countDetections,
  decideAllPendingOfType,
  idsOfType,
} from '../../../src/renderer/src/review/bulk'
import {
  previewsForStore,
  sessionToDetections,
} from '../../../src/renderer/src/review/from-session'
import { focusedIdsOf } from '../../../src/renderer/src/review/highlights'
import { useReviewStore } from '../../../src/renderer/src/review/store'
import { headOf, headsOf, membersOf } from '../../../src/renderer/src/review/types'

const piece = (id: string, seg: string, i: number) => ({
  detection_id: id,
  entity_type: 'PERSON',
  score: 0.9,
  original: 'x',
  segment_anchor: seg,
  start: 0,
  end: 1,
  group_id: 'g1',
  group_index: i,
  group_original: 'Jennifer Martin',
})

const single = (id: string, seg: string) => ({
  detection_id: id,
  entity_type: 'PERSON',
  score: 0.9,
  original: 'Ann',
  segment_anchor: seg,
  start: 0,
  end: 3,
})

function sessionWith(
  proposals: readonly ReviewProposal[],
  overrides: Partial<ReviewSessionResponse> = {},
): ReviewSessionResponse {
  return {
    id: 'sess-1',
    source_path: '/tmp/letter.docx',
    format: 'docx',
    default_operator: 'replace',
    default_operator_params: {},
    segments: [],
    proposals,
    decisions: [],
    status: 'open',
    created_at: '2026-04-25T12:00:00Z',
    committed_at: null,
    previews: {},
    ...overrides,
  }
}

function fakeClient(overrides: Partial<SessionsClient> = {}): SessionsClient {
  const noop = (): Promise<never> => Promise.reject(new Error('not implemented in this test'))
  return {
    listSessions: noop,
    createSession: noop,
    getSession: noop,
    getSessionInput: noop,
    getLayout: noop,
    patchDecision: noop,
    addUserAdded: noop,
    deleteUserAdded: noop,
    commitSession: noop,
    abandonSession: noop,
    ...overrides,
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

const twoPieces = (): ReturnType<typeof sessionToDetections> =>
  sessionToDetections(sessionWith([piece('a', 'p0/r0', 0), piece('b', 'p0/r2', 1)]))

describe('linked findings', () => {
  beforeEach(() => {
    useReviewStore.getState().clear()
  })

  it('maps group fields and counts a group once', () => {
    const dets = twoPieces()
    expect(dets.map((d) => [d.id, d.groupId, d.groupIndex, d.groupText])).toEqual([
      ['a', 'g1', 0, 'Jennifer Martin'],
      ['b', 'g1', 1, 'Jennifer Martin'],
    ])
    expect(countDetections(dets).pending).toBe(1)
  })

  it('setStatus on any piece updates every piece', () => {
    useReviewStore.getState().setDetections(twoPieces())
    useReviewStore.getState().setStatus('b', 'accepted')
    expect(useReviewStore.getState().detections.map((d) => d.status)).toEqual([
      'accepted',
      'accepted',
    ])
  })

  it('focus navigation and focusing a tail land on the head', () => {
    useReviewStore.getState().setDetections(twoPieces())
    useReviewStore.getState().setFocused('b')
    expect(useReviewStore.getState().focusedId).toBe('a')
  })

  it('leaves single findings without group fields', () => {
    const [d] = sessionToDetections(
      sessionWith([
        { ...single('s', 'p1/r0'), group_id: null, group_index: 0, group_original: null },
      ]),
    )
    expect(d?.groupId).toBeUndefined()
    expect(d?.groupIndex).toBeUndefined()
    expect(d?.groupText).toBeUndefined()
  })

  it('headOf / membersOf / headsOf', () => {
    const dets = sessionToDetections(
      sessionWith([piece('a', 'p0/r0', 0), single('s', 'p1/r0'), piece('b', 'p0/r2', 1)]),
    )
    expect(headOf(dets, 'b')?.id).toBe('a')
    expect(headOf(dets, 's')?.id).toBe('s')
    expect(membersOf(dets, 'a').map((d) => d.id)).toEqual(['a', 'b'])
    expect(membersOf(dets, 's').map((d) => d.id)).toEqual(['s'])
    expect(headsOf(dets).map((d) => d.id)).toEqual(['a', 's'])
  })

  it('treats the lowest remaining index as head when the 0 piece is gone', () => {
    const dets = sessionToDetections(sessionWith([piece('b', 'p0/r2', 1), piece('c', 'p0/r4', 2)]))
    expect(headOf(dets, 'c')?.id).toBe('b')
  })

  it('arrow navigation and next-pending skip tail pieces', () => {
    useReviewStore
      .getState()
      .setDetections(
        sessionToDetections(
          sessionWith([piece('a', 'p0/r0', 0), piece('b', 'p0/r2', 1), single('s', 'p1/r0')]),
        ),
      )
    const s = useReviewStore.getState
    expect(s().focusedId).toBe('a')
    s().focusNext()
    expect(s().focusedId).toBe('s')
    s().focusNext()
    expect(s().focusedId).toBe('a')
    s().focusPrev()
    expect(s().focusedId).toBe('s')
    s().setFocused('s')
    s().setStatus('s', 'accepted')
    s().focusNextPending()
    expect(s().focusedId).toBe('a')
  })

  it('undo restores every member of a group', () => {
    useReviewStore.getState().setDetections(twoPieces())
    useReviewStore.getState().setStatus('a', 'rejected')
    expect(useReviewStore.getState().undoStack).toHaveLength(1)
    useReviewStore.getState().undoLastDecision()
    expect(useReviewStore.getState().detections.map((d) => d.status)).toEqual([
      'pending',
      'pending',
    ])
  })

  it('setCustomReplacement reaches every member', () => {
    useReviewStore.getState().setDetections(twoPieces())
    useReviewStore.getState().setCustomReplacement('b', 'Someone')
    expect(useReviewStore.getState().detections.map((d) => d.customReplacement)).toEqual([
      'Someone',
      'Someone',
    ])
  })

  it('setPreview on a group puts the replacement on the head and blanks the tails', () => {
    useReviewStore.getState().setDetections(twoPieces())
    useReviewStore.getState().setPreview('b', '<PERSON>')
    expect(useReviewStore.getState().previews).toEqual({ a: '<PERSON>', b: '' })
  })

  it('bulk helpers count and decide heads only', () => {
    const dets = sessionToDetections(
      sessionWith([piece('a', 'p0/r0', 0), piece('b', 'p0/r2', 1), single('s', 'p1/r0')]),
    )
    expect(idsOfType(dets, 'PERSON')).toEqual(['a', 's'])
    expect(countDetections(dets).total).toBe(2)
    const accept = vi.fn<(id: string) => void>()
    const n = decideAllPendingOfType(dets, 'PERSON', 'accept', {
      accept,
      reject: vi.fn(),
      setOperator: vi.fn(),
      setCustomReplacement: vi.fn(),
      addMissed: vi.fn(),
      addMissedAndWait: vi.fn(),
      undoLastDecision: vi.fn(),
    })
    expect(n).toBe(2)
    expect(accept.mock.calls.map((c) => c[0])).toEqual(['a', 's'])
  })

  it('a focused head paints every member as focused', () => {
    const dets = twoPieces()
    expect([...focusedIdsOf(dets, 'a')].sort()).toEqual(['a', 'b'])
    expect([...focusedIdsOf(dets, null)]).toEqual([])
  })

  it('previewsForStore keeps tail previews', () => {
    const session = sessionWith([piece('a', 'p0/r0', 0), piece('b', 'p0/r2', 1)], {
      previews: { a: '<PERSON>', b: '' },
    })
    expect(previewsForStore(session)).toEqual({ a: '<PERSON>', b: '' })
  })
})

describe('linked findings, synced actions', () => {
  beforeEach(() => {
    useReviewStore.getState().clear()
  })

  it('accepting a tail sends one PATCH for the head and updates the whole group', async () => {
    useReviewStore.getState().setDetections(twoPieces())
    const patchDecision = vi.fn(() =>
      Promise.resolve({ decision: {} as never, preview: '<PERSON>' }),
    )
    const actions = syncedActions({ client: fakeClient({ patchDecision }), sessionId: 'sess-1' })
    actions.accept('b')
    expect(useReviewStore.getState().detections.map((d) => d.status)).toEqual([
      'accepted',
      'accepted',
    ])
    await flush()
    expect(patchDecision).toHaveBeenCalledTimes(1)
    expect(patchDecision).toHaveBeenCalledWith('sess-1', 'a', expect.anything())
    expect(useReviewStore.getState().previews).toEqual({ a: '<PERSON>', b: '' })
  })

  it('a failed PATCH rolls the whole group back', async () => {
    useReviewStore.getState().setDetections(twoPieces())
    const patchDecision = vi.fn(() => Promise.reject(new Error('boom')))
    const actions = syncedActions({ client: fakeClient({ patchDecision }), sessionId: 'sess-1' })
    actions.reject('a')
    await flush()
    expect(useReviewStore.getState().detections.map((d) => d.status)).toEqual([
      'pending',
      'pending',
    ])
  })

  it('a user-add that removes part of a group resyncs the survivors from the engine', async () => {
    useReviewStore
      .getState()
      .setDetections(
        sessionToDetections(
          sessionWith([piece('a', 'p0/r0', 0), piece('b', 'p0/r2', 1), single('s', 'p1/r0')]),
        ),
      )
    useReviewStore.getState().setStatus('s', 'accepted')
    const after = sessionWith(
      [{ ...piece('b', 'p0/r2', 0), original: 'Martin', start: 1, end: 7 }, single('s', 'p1/r0')],
      {
        decisions: [
          {
            kind: 'user_added',
            id: 'ua1',
            segment_anchor: 'p0/r0',
            entity_type: 'USER_ADDED',
            original: 'x',
            start: 0,
            end: 1,
            operator: null,
            operator_params: {},
            custom_replacement: null,
          } as never,
        ],
        previews: { b: '<PERSON>', ua1: '<USER_ADDED>' },
      },
    )
    const addUserAdded = vi.fn(() =>
      Promise.resolve({
        decision: after.decisions[0] as never,
        preview: '<USER_ADDED>',
        removed_proposal_ids: ['a'],
      }),
    )
    const getSession = vi.fn(() => Promise.resolve(after))
    const actions = syncedActions({
      client: fakeClient({ addUserAdded, getSession }),
      sessionId: 'sess-1',
    })
    const ok = await actions.addMissedAndWait({
      locator: { segmentId: 'p0/r0', start: 0, end: 1 },
      text: 'x',
    })
    expect(ok).toBe(true)
    await flush()
    expect(getSession).toHaveBeenCalledWith('sess-1')
    const dets = useReviewStore.getState().detections
    const b = dets.find((d) => d.id === 'b')
    expect(b).toMatchObject({ groupIndex: 0, text: 'Martin', start: 1, end: 7 })
    expect(dets.find((d) => d.id === 's')?.status).toBe('accepted')
    expect(dets.some((d) => d.id === 'user:ua1')).toBe(true)
    expect(useReviewStore.getState().previews.b).toBe('<PERSON>')
    // The user-add stays undoable after the resync.
    expect(useReviewStore.getState().undoStack.at(-1)).toMatchObject({ kind: 'user-add' })
  })
})
