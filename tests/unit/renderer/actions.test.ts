// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionsClient } from '../../../src/renderer/src/api/sessions'
import { ApiError } from '../../../src/renderer/src/api/types'
import { syncedActions } from '../../../src/renderer/src/review/actions'
import { useReviewStore } from '../../../src/renderer/src/review/store'
import type { Detection } from '../../../src/renderer/src/review/types'

function makeDetection(id: string, overrides: Partial<Detection> = {}): Detection {
  return {
    id,
    segmentId: 'body/p0/r0',
    start: 0,
    end: 5,
    text: id,
    entityType: 'PERSON',
    status: 'pending',
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
    patchDecision: noop,
    addUserAdded: noop,
    deleteUserAdded: noop,
    commitSession: noop,
    abandonSession: noop,
    ...overrides,
  }
}

function flushMicrotasks(): Promise<void> {
  // Two ticks: one for the optimistic update's await, one for the
  // resolution of the mocked client promise.
  return Promise.resolve().then(() => Promise.resolve())
}

describe('syncedActions.accept', () => {
  beforeEach(() => {
    useReviewStore.getState().clear()
  })

  it('optimistically flips status, then PATCHes with current operator + replacement', async () => {
    useReviewStore
      .getState()
      .setDetections([makeDetection('det-1', { operator: 'mask', customReplacement: '[name]' })])
    const patchDecision = vi.fn(() => Promise.resolve({ decision: {} as never, preview: '' }))
    const actions = syncedActions({
      client: fakeClient({ patchDecision }),
      sessionId: 'sess-1',
    })

    actions.accept('det-1')
    expect(useReviewStore.getState().detections[0]?.status).toBe('accepted')
    await flushMicrotasks()

    expect(patchDecision).toHaveBeenCalledWith('sess-1', 'det-1', {
      status: 'accept',
      operator: 'mask',
      custom_replacement: '[name]',
    })
  })

  it('rolls back the optimistic flip when the PATCH rejects', async () => {
    useReviewStore.getState().setDetections([makeDetection('det-1')])
    const err = new ApiError(503, null, 'sidecar unreachable')
    const patchDecision = vi.fn(() => Promise.reject(err))
    const actions = syncedActions({
      client: fakeClient({ patchDecision }),
      sessionId: 'sess-1',
    })

    actions.accept('det-1')
    await flushMicrotasks()

    expect(useReviewStore.getState().detections[0]?.status).toBe('pending')
    expect(useReviewStore.getState().lastSyncError?.message).toContain('sidecar unreachable')
    expect(useReviewStore.getState().lastSyncError?.status).toBe(503)
  })

  it('skips the PATCH for user-added detections (always-accepted on backend)', async () => {
    useReviewStore
      .getState()
      .setDetections([makeDetection('user:abc', { entityType: 'USER_ADDED' })])
    const patchDecision = vi.fn()
    const actions = syncedActions({
      client: fakeClient({ patchDecision }),
      sessionId: 'sess-1',
    })

    actions.accept('user:abc')
    await flushMicrotasks()

    expect(patchDecision).not.toHaveBeenCalled()
    expect(useReviewStore.getState().detections[0]?.status).toBe('accepted')
  })
})

describe('syncedActions.reject', () => {
  beforeEach(() => {
    useReviewStore.getState().clear()
  })

  it('PATCHes status=reject for proposal-derived detections', async () => {
    useReviewStore.getState().setDetections([makeDetection('det-1')])
    const patchDecision = vi.fn(() => Promise.resolve({ decision: {} as never, preview: '' }))
    const actions = syncedActions({
      client: fakeClient({ patchDecision }),
      sessionId: 'sess-1',
    })

    actions.reject('det-1')
    await flushMicrotasks()

    expect(patchDecision).toHaveBeenCalledWith('sess-1', 'det-1', {
      status: 'reject',
      operator: null,
      custom_replacement: null,
    })
  })

  it('DELETEs and removes a user-added detection from the store', async () => {
    useReviewStore
      .getState()
      .setDetections([makeDetection('user:abc-uuid', { entityType: 'USER_ADDED' })])
    const deleteUserAdded = vi.fn(() => Promise.resolve())
    const actions = syncedActions({
      client: fakeClient({ deleteUserAdded }),
      sessionId: 'sess-1',
    })

    actions.reject('user:abc-uuid')
    await flushMicrotasks()

    expect(deleteUserAdded).toHaveBeenCalledWith('sess-1', 'abc-uuid')
    expect(useReviewStore.getState().detections).toHaveLength(0)
  })

  it('rolls the user-added detection back into the store when DELETE fails', async () => {
    useReviewStore
      .getState()
      .setDetections([makeDetection('user:abc-uuid', { entityType: 'USER_ADDED' })])
    const deleteUserAdded = vi.fn(() => Promise.reject(new Error('boom')))
    const actions = syncedActions({
      client: fakeClient({ deleteUserAdded }),
      sessionId: 'sess-1',
    })

    actions.reject('user:abc-uuid')
    await flushMicrotasks()

    expect(useReviewStore.getState().detections[0]?.status).toBe('pending')
    expect(useReviewStore.getState().lastSyncError?.message).toContain('boom')
  })
})

describe('syncedActions.setOperator', () => {
  beforeEach(() => {
    useReviewStore.getState().clear()
  })

  it('skips the PATCH for pending detections (no decision exists yet)', async () => {
    useReviewStore.getState().setDetections([makeDetection('det-1')])
    const patchDecision = vi.fn()
    const actions = syncedActions({
      client: fakeClient({ patchDecision }),
      sessionId: 'sess-1',
    })

    actions.setOperator('det-1', 'mask')
    await flushMicrotasks()

    expect(patchDecision).not.toHaveBeenCalled()
    expect(useReviewStore.getState().detections[0]?.operator).toBe('mask')
  })

  it('PATCHes when status is accepted, preserving the verdict', async () => {
    useReviewStore.getState().setDetections([makeDetection('det-1', { status: 'accepted' })])
    const patchDecision = vi.fn(() => Promise.resolve({ decision: {} as never, preview: '' }))
    const actions = syncedActions({
      client: fakeClient({ patchDecision }),
      sessionId: 'sess-1',
    })

    actions.setOperator('det-1', 'mask')
    await flushMicrotasks()

    expect(patchDecision).toHaveBeenCalledWith(
      'sess-1',
      'det-1',
      expect.objectContaining({ status: 'accept', operator: 'mask' }),
    )
  })
})

describe('syncedActions.addMissed', () => {
  beforeEach(() => {
    useReviewStore.getState().clear()
  })

  it('POSTs the span and appends with the backend-minted id on success', async () => {
    const addUserAdded = vi.fn(() =>
      Promise.resolve({
        decision: {
          kind: 'user_added' as const,
          id: 'backend-uuid',
          segment_anchor: 'body/p4/r0',
          entity_type: 'USER_ADDED',
          original: 'Smith',
          start: 9,
          end: 14,
        },
        preview: '<PERSON>',
      }),
    )
    const actions = syncedActions({
      client: fakeClient({ addUserAdded }),
      sessionId: 'sess-1',
    })

    actions.addMissed({
      locator: { segmentId: 'body/p4/r0', start: 9, end: 14 },
      text: 'Smith',
    })
    await flushMicrotasks()

    expect(addUserAdded).toHaveBeenCalledWith('sess-1', {
      segment_anchor: 'body/p4/r0',
      entity_type: 'USER_ADDED',
      original: 'Smith',
      start: 9,
      end: 14,
    })
    const detections = useReviewStore.getState().detections
    expect(detections).toHaveLength(1)
    expect(detections[0]?.id).toBe('user:backend-uuid')
    expect(detections[0]?.status).toBe('accepted')
  })

  it('drops detections + previews the backend purged via removed_proposal_ids', async () => {
    // sanctum#31: backend deletes any model proposal whose char range
    // overlaps the new UA span. The renderer mirrors that cascade so a
    // session refetch isn't needed.
    useReviewStore
      .getState()
      .setDetections([
        makeDetection('p_miller', { start: 35, end: 41, text: 'Miller' }),
        makeDetection('p_henderson', { start: 43, end: 52, text: 'Henderson' }),
        makeDetection('p_unrelated', { segmentId: 'body/p9/r0', start: 0, end: 4, text: 'keep' }),
      ])
    useReviewStore.getState().setPreviews({
      p_miller: '<LOCATION>',
      p_henderson: '<LOCATION>',
      p_unrelated: '<PERSON>',
    })
    const addUserAdded = vi.fn(() =>
      Promise.resolve({
        decision: {
          kind: 'user_added' as const,
          id: 'backend-uuid',
          segment_anchor: 'body/p4/r0',
          entity_type: 'USER_ADDED',
          original: 'Miller, Henderson and Johnson',
          start: 35,
          end: 64,
        },
        preview: '<ORGANIZATION>',
        removed_proposal_ids: ['p_miller', 'p_henderson'],
      }),
    )
    const actions = syncedActions({
      client: fakeClient({ addUserAdded }),
      sessionId: 'sess-1',
    })

    actions.addMissed({
      locator: { segmentId: 'body/p4/r0', start: 35, end: 64 },
      text: 'Miller, Henderson and Johnson',
    })
    await flushMicrotasks()

    const detectionIds = useReviewStore.getState().detections.map((d) => d.id)
    expect(detectionIds).toEqual(['p_unrelated', 'user:backend-uuid'])
    expect(useReviewStore.getState().previews).toEqual({
      p_unrelated: '<PERSON>',
      'user:backend-uuid': '<ORGANIZATION>',
    })
  })

  it('surfaces an error when the addMissed POST fails', async () => {
    const addUserAdded = vi.fn(() => Promise.reject(new ApiError(409, null, 'session committed')))
    const actions = syncedActions({
      client: fakeClient({ addUserAdded }),
      sessionId: 'sess-1',
    })

    actions.addMissed({
      locator: { segmentId: 'body/p4/r0', start: 9, end: 14 },
      text: 'Smith',
    })
    await flushMicrotasks()

    expect(useReviewStore.getState().detections).toHaveLength(0)
    expect(useReviewStore.getState().lastSyncError?.message).toContain('session committed')
    expect(useReviewStore.getState().lastSyncError?.status).toBe(409)
  })

  it('drops focus from the prior detection while the POST is in flight (#18)', async () => {
    // Without this, the user sees the previously-focused detection (often
    // the first item, already accepted) appear to "stay selected" through
    // the round-trip — exactly the symptom reported in #18.
    useReviewStore.getState().setDetections([makeDetection('p_first', { status: 'accepted' })])
    useReviewStore.getState().setFocused('p_first')

    interface AddUserAddedResolution {
      decision: {
        kind: 'user_added'
        id: string
        segment_anchor: string
        entity_type: string
        original: string
        start: number
        end: number
      }
      preview: string
    }
    let resolvePost: (value: AddUserAddedResolution) => void = () => {
      // overwritten below before the POST settles
    }
    const addUserAdded = vi.fn(
      () =>
        new Promise<AddUserAddedResolution>((resolve) => {
          resolvePost = resolve
        }),
    )
    const actions = syncedActions({
      client: fakeClient({ addUserAdded }),
      sessionId: 'sess-1',
    })

    actions.addMissed({
      locator: { segmentId: 'body/p4/r0', start: 9, end: 14 },
      text: 'Smith',
    })

    // Synchronous slice: focus must already be cleared by the time the
    // dispatcher returns control to the keyboard loop. Otherwise the
    // reviewer's accept/reject keypresses during the in-flight POST would
    // act on `p_first` (the prior focus) instead of the span they just
    // marked.
    expect(useReviewStore.getState().focusedId).toBeNull()

    resolvePost({
      decision: {
        kind: 'user_added',
        id: 'backend-uuid',
        segment_anchor: 'body/p4/r0',
        entity_type: 'USER_ADDED',
        original: 'Smith',
        start: 9,
        end: 14,
      },
      preview: '<PERSON>',
    })
    await flushMicrotasks()

    // After the POST resolves, focus lands on the new detection so the
    // reviewer can immediately tweak its operator / replacement.
    expect(useReviewStore.getState().focusedId).toBe('user:backend-uuid')
  })
})

describe('syncedActions previews map', () => {
  beforeEach(() => {
    useReviewStore.getState().clear()
  })

  it('writes the PATCH-response preview into the store under the detection id', async () => {
    useReviewStore.getState().setDetections([makeDetection('det-1')])
    const patchDecision = vi.fn(() =>
      Promise.resolve({ decision: {} as never, preview: '<PERSON>' }),
    )
    const actions = syncedActions({
      client: fakeClient({ patchDecision }),
      sessionId: 'sess-1',
    })

    actions.accept('det-1')
    await flushMicrotasks()

    expect(useReviewStore.getState().previews).toEqual({ 'det-1': '<PERSON>' })
  })

  it('writes the POST-response preview after a synced addMissed', async () => {
    const addUserAdded = vi.fn(() =>
      Promise.resolve({
        decision: {
          kind: 'user_added' as const,
          id: 'backend-uuid',
          segment_anchor: 'body/p4/r0',
          entity_type: 'USER_ADDED',
          original: 'Smith',
          start: 9,
          end: 14,
        },
        preview: '[CUSTOM]',
      }),
    )
    const actions = syncedActions({
      client: fakeClient({ addUserAdded }),
      sessionId: 'sess-1',
    })

    actions.addMissed({
      locator: { segmentId: 'body/p4/r0', start: 9, end: 14 },
      text: 'Smith',
    })
    await flushMicrotasks()

    expect(useReviewStore.getState().previews).toEqual({ 'user:backend-uuid': '[CUSTOM]' })
  })

  it('clears the preview entry when a user-added decision is rejected (DELETE)', async () => {
    useReviewStore
      .getState()
      .setDetections([makeDetection('user:abc-uuid', { entityType: 'USER_ADDED' })])
    useReviewStore.getState().setPreview('user:abc-uuid', '[STALE]')
    const deleteUserAdded = vi.fn(() => Promise.resolve())
    const actions = syncedActions({
      client: fakeClient({ deleteUserAdded }),
      sessionId: 'sess-1',
    })

    actions.reject('user:abc-uuid')
    await flushMicrotasks()

    expect(useReviewStore.getState().previews).toEqual({})
  })
})

describe('syncedActions.undoLastDecision', () => {
  beforeEach(() => {
    useReviewStore.getState().clear()
  })

  it('PATCHes back to the prior verdict when reverting accept→reject', async () => {
    useReviewStore.getState().setDetections([makeDetection('det-1', { status: 'rejected' })])
    // Push an undoStack entry that says det-1 was previously accepted.
    useReviewStore.setState((s) => ({
      undoStack: [...s.undoStack, { id: 'det-1', previous: 'accepted' }],
    }))
    const patchDecision = vi.fn(() => Promise.resolve({ decision: {} as never, preview: '' }))
    const actions = syncedActions({
      client: fakeClient({ patchDecision }),
      sessionId: 'sess-1',
    })

    actions.undoLastDecision()
    await flushMicrotasks()

    expect(useReviewStore.getState().detections[0]?.status).toBe('accepted')
    expect(patchDecision).toHaveBeenCalledWith(
      'sess-1',
      'det-1',
      expect.objectContaining({ status: 'accept' }),
    )
  })

  it('skips the PATCH when the previous status was pending (no DELETE endpoint yet)', async () => {
    useReviewStore.getState().setDetections([makeDetection('det-1', { status: 'accepted' })])
    useReviewStore.setState((s) => ({
      undoStack: [...s.undoStack, { id: 'det-1', previous: 'pending' }],
    }))
    const patchDecision = vi.fn()
    const actions = syncedActions({
      client: fakeClient({ patchDecision }),
      sessionId: 'sess-1',
    })

    actions.undoLastDecision()
    await flushMicrotasks()

    expect(patchDecision).not.toHaveBeenCalled()
    expect(useReviewStore.getState().detections[0]?.status).toBe('pending')
  })
})
