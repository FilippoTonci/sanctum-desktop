import { beforeEach, describe, expect, it } from 'vitest'
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

describe('useReviewStore', () => {
  beforeEach(() => {
    useReviewStore.getState().clear()
  })

  it('setDetections seeds the list and focuses the first entry', () => {
    const list = [makeDetection('a'), makeDetection('b'), makeDetection('c')]
    useReviewStore.getState().setDetections(list)
    expect(useReviewStore.getState().detections).toEqual(list)
    expect(useReviewStore.getState().focusedId).toBe('a')
  })

  it('setDetections clears focus when the list is empty', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    useReviewStore.getState().setDetections([])
    expect(useReviewStore.getState().focusedId).toBeNull()
  })

  it('clear empties detections and focus', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    useReviewStore.getState().clear()
    expect(useReviewStore.getState().detections).toEqual([])
    expect(useReviewStore.getState().focusedId).toBeNull()
  })

  it('setStatus updates only the targeted detection', () => {
    useReviewStore.getState().setDetections([makeDetection('a'), makeDetection('b')])
    useReviewStore.getState().setStatus('a', 'accepted')
    const after = useReviewStore.getState().detections
    expect(after.find((d) => d.id === 'a')?.status).toBe('accepted')
    expect(after.find((d) => d.id === 'b')?.status).toBe('pending')
  })

  it('focusNext wraps from the last entry to the first', () => {
    useReviewStore.getState().setDetections([makeDetection('a'), makeDetection('b')])
    useReviewStore.getState().setFocused('b')
    useReviewStore.getState().focusNext()
    expect(useReviewStore.getState().focusedId).toBe('a')
  })

  it('focusPrev wraps from the first entry to the last', () => {
    useReviewStore.getState().setDetections([makeDetection('a'), makeDetection('b')])
    useReviewStore.getState().focusPrev()
    expect(useReviewStore.getState().focusedId).toBe('b')
  })

  it('focusNext / focusPrev are no-ops on an empty list', () => {
    useReviewStore.getState().focusNext()
    expect(useReviewStore.getState().focusedId).toBeNull()
    useReviewStore.getState().focusPrev()
    expect(useReviewStore.getState().focusedId).toBeNull()
  })

  it('setFocused accepts null to clear focus', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    useReviewStore.getState().setFocused(null)
    expect(useReviewStore.getState().focusedId).toBeNull()
  })

  it('undoLastDecision reverses verdicts in LIFO order', () => {
    useReviewStore.getState().setDetections([makeDetection('a'), makeDetection('b')])
    useReviewStore.getState().setStatus('a', 'accepted')
    useReviewStore.getState().setStatus('b', 'rejected')
    useReviewStore.getState().undoLastDecision()
    expect(useReviewStore.getState().detections[1]?.status).toBe('pending')
    expect(useReviewStore.getState().detections[0]?.status).toBe('accepted')
    useReviewStore.getState().undoLastDecision()
    expect(useReviewStore.getState().detections[0]?.status).toBe('pending')
  })

  it('undoLastDecision is a no-op when the stack is empty', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    useReviewStore.getState().undoLastDecision()
    expect(useReviewStore.getState().detections[0]?.status).toBe('pending')
  })

  it('setStatus does not push an edit when the status is unchanged', () => {
    useReviewStore.getState().setDetections([makeDetection('a', { status: 'accepted' })])
    useReviewStore.getState().setStatus('a', 'accepted')
    expect(useReviewStore.getState().undoStack).toHaveLength(0)
  })

  it('setDetections clears the undo stack so it cannot leak across documents', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    useReviewStore.getState().setStatus('a', 'accepted')
    useReviewStore.getState().setDetections([makeDetection('b')])
    expect(useReviewStore.getState().undoStack).toHaveLength(0)
  })

  it('enterSelectMode flips the flag, exitSelectMode unflips', () => {
    useReviewStore.getState().enterSelectMode()
    expect(useReviewStore.getState().selectMode).toBe(true)
    useReviewStore.getState().exitSelectMode()
    expect(useReviewStore.getState().selectMode).toBe(false)
  })

  it('addMissed appends a USER_ADDED detection, exits select-mode, focuses it', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    useReviewStore.getState().enterSelectMode()
    const id = useReviewStore.getState().addMissed({
      locator: { segmentId: 'body/p1/r0', start: 0, end: 5 },
      text: 'Smith',
    })
    const state = useReviewStore.getState()
    expect(state.selectMode).toBe(false)
    expect(state.focusedId).toBe(id)
    expect(state.detections).toHaveLength(2)
    const added = state.detections[1]!
    expect(added.entityType).toBe('USER_ADDED')
    expect(added.text).toBe('Smith')
    expect(added.status).toBe('pending')
  })

  it('addMissed deduplicates: re-marking the same span just refocuses it', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    const id1 = useReviewStore.getState().addMissed({
      locator: { segmentId: 'body/p1/r0', start: 0, end: 5 },
      text: 'Smith',
    })
    const id2 = useReviewStore.getState().addMissed({
      locator: { segmentId: 'body/p1/r0', start: 0, end: 5 },
      text: 'Smith',
    })
    expect(id1).toBe(id2)
    expect(useReviewStore.getState().detections).toHaveLength(2)
  })

  it('setOperator overrides the default for one detection only', () => {
    useReviewStore.getState().setDetections([makeDetection('a'), makeDetection('b')])
    useReviewStore.getState().setOperator('a', 'mask')
    expect(useReviewStore.getState().detections[0]?.operator).toBe('mask')
    expect(useReviewStore.getState().detections[1]?.operator).toBeUndefined()
  })

  it('setCustomReplacement(id, null) clears the replacement', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    useReviewStore.getState().setCustomReplacement('a', '[REDACTED]')
    expect(useReviewStore.getState().detections[0]?.customReplacement).toBe('[REDACTED]')
    useReviewStore.getState().setCustomReplacement('a', null)
    expect(useReviewStore.getState().detections[0]?.customReplacement).toBeUndefined()
  })

  it('buildCommitPayload mirrors the current store state into a server-shaped payload', () => {
    useReviewStore
      .getState()
      .setDetections([
        makeDetection('a', { status: 'accepted' }),
        makeDetection('b', { status: 'rejected' }),
      ])
    useReviewStore.getState().setOperator('a', 'mask')
    useReviewStore.getState().setCustomReplacement('a', '[name]')
    useReviewStore.getState().addMissed({
      locator: { segmentId: 'body/p1/r0', start: 0, end: 4 },
      text: 'Acme',
    })

    const payload = useReviewStore.getState().buildCommitPayload('attested')
    expect(payload.attestation).toBe('attested')
    expect(payload.defaultOperator).toBe('hips')
    expect(payload.decisions).toHaveLength(3)

    const proposed = payload.decisions.find((d) => d.id === 'a')
    expect(proposed?.source).toBe('proposed')
    expect(proposed?.operator).toBe('mask')
    expect(proposed?.customReplacement).toBe('[name]')

    const userAdded = payload.decisions.find((d) => d.id.startsWith('user:'))
    expect(userAdded?.source).toBe('user-added')
  })

  it('openCommitPanel / closeCommitPanel toggle the panel flag', () => {
    useReviewStore.getState().openCommitPanel()
    expect(useReviewStore.getState().commitPanelOpen).toBe(true)
    useReviewStore.getState().closeCommitPanel()
    expect(useReviewStore.getState().commitPanelOpen).toBe(false)
  })

  it('startEditingReplacement records the target detection id, null clears', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    useReviewStore.getState().startEditingReplacement('a')
    expect(useReviewStore.getState().editingReplacementId).toBe('a')
    useReviewStore.getState().startEditingReplacement(null)
    expect(useReviewStore.getState().editingReplacementId).toBeNull()
  })
})
