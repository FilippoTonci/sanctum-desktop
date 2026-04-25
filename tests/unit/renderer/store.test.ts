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
})
