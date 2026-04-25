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
    patchDecision: noop,
    addUserAdded: noop,
    deleteUserAdded: noop,
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
    expect(useReviewStore.getState().lastSyncError).toContain('sidecar unreachable')
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
    expect(useReviewStore.getState().lastSyncError).toContain('boom')
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

  it('exits select-mode and surfaces an error when the POST fails', async () => {
    useReviewStore.getState().enterSelectMode()
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

    expect(useReviewStore.getState().selectMode).toBe(false)
    expect(useReviewStore.getState().detections).toHaveLength(0)
    expect(useReviewStore.getState().lastSyncError).toContain('session committed')
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
