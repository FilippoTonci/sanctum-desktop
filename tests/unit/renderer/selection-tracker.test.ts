// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMissedSelectionTracker } from '../../../src/renderer/src/review/selection-tracker'
import { useReviewStore } from '../../../src/renderer/src/review/store'

function setBody(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

function selectAcross(
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
): void {
  const sel = window.getSelection()
  if (sel === null) throw new Error('no selection api')
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  sel.removeAllRanges()
  sel.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

function clearSelection(): void {
  const sel = window.getSelection()
  sel?.removeAllRanges()
  document.dispatchEvent(new Event('selectionchange'))
}

describe('useMissedSelectionTracker', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    useReviewStore.getState().clear()
  })

  it('writes pendingMissedSelection when a valid range is selected', () => {
    const root = setBody('<p><span data-segment-id="seg/0">until May 13, 2027, unless</span></p>')
    renderHook(() => {
      useMissedSelectionTracker(root)
    })
    const seg = root.querySelector('[data-segment-id="seg/0"]')!
    const textNode = seg.firstChild as Text
    selectAcross(textNode, 0, textNode, 26)
    const pending = useReviewStore.getState().pendingMissedSelection
    expect(pending).not.toBeNull()
    expect(pending?.locator).toEqual({ segmentId: 'seg/0', start: 0, end: 26 })
    expect(pending?.text).toBe('until May 13, 2027, unless')
  })

  it('writes null when the selection collapses', () => {
    const root = setBody('<p><span data-segment-id="seg/0">hello</span></p>')
    renderHook(() => {
      useMissedSelectionTracker(root)
    })
    const textNode = root.querySelector('[data-segment-id="seg/0"]')!.firstChild as Text
    selectAcross(textNode, 0, textNode, 3)
    clearSelection()
    expect(useReviewStore.getState().pendingMissedSelection).toBeNull()
  })

  it('writes null when the selection straddles two segments', () => {
    const root = setBody(
      '<p><span data-segment-id="seg/0">hello</span> <span data-segment-id="seg/1">world</span></p>',
    )
    renderHook(() => {
      useMissedSelectionTracker(root)
    })
    const seg0 = root.querySelector('[data-segment-id="seg/0"]')!.firstChild as Text
    const seg1 = root.querySelector('[data-segment-id="seg/1"]')!.firstChild as Text
    selectAcross(seg0, 0, seg1, 5)
    expect(useReviewStore.getState().pendingMissedSelection).toBeNull()
  })

  it('writes null when the selection is only whitespace', () => {
    const root = setBody('<p><span data-segment-id="seg/0">   </span></p>')
    renderHook(() => {
      useMissedSelectionTracker(root)
    })
    const textNode = root.querySelector('[data-segment-id="seg/0"]')!.firstChild as Text
    selectAcross(textNode, 0, textNode, 3)
    expect(useReviewStore.getState().pendingMissedSelection).toBeNull()
  })

  it('writes null when the selection is outside the tracked root', () => {
    document.body.innerHTML =
      '<div id="other"><p><span data-segment-id="seg/0">hello</span></p></div>' +
      '<div id="root"><p><span data-segment-id="seg/1">world</span></p></div>'
    const root = document.getElementById('root')!
    renderHook(() => {
      useMissedSelectionTracker(root)
    })
    const textNode = document.querySelector('#other [data-segment-id="seg/0"]')!.firstChild as Text
    selectAcross(textNode, 0, textNode, 5)
    expect(useReviewStore.getState().pendingMissedSelection).toBeNull()
  })

  it('writes null when both endpoints are inside a .sanctum-edit-replacement span', () => {
    const root = setBody(
      '<p><span data-segment-id="seg/0">until ' +
        '<span class="sanctum-edit" data-detection-id="d1">' +
        '<span class="sanctum-edit-original">May 13, 2027</span>' +
        '<span class="sanctum-edit-replacement">DATE_PLACEHOLDER</span>' +
        '</span>, unless</span></p>',
    )
    renderHook(() => {
      useMissedSelectionTracker(root)
    })
    const replacementText = root.querySelector('.sanctum-edit-replacement')!.firstChild as Text
    selectAcross(replacementText, 0, replacementText, 4)
    expect(useReviewStore.getState().pendingMissedSelection).toBeNull()
  })

  it('writes a valid value when the selection spans across an existing detection wrap', () => {
    // Bug 1 regression: captured text must exclude .sanctum-edit-replacement chars
    const root = setBody(
      '<p><span data-segment-id="seg/0">until ' +
        '<span class="sanctum-edit" data-detection-id="d1">' +
        '<span class="sanctum-edit-original">May 13, 2027</span>' +
        '<span class="sanctum-edit-replacement">DATE_PLACEHOLDER</span>' +
        '</span>, unless</span></p>',
    )
    renderHook(() => {
      useMissedSelectionTracker(root)
    })
    const seg = root.querySelector('[data-segment-id="seg/0"]')!
    const leading = seg.firstChild as Text
    const trailing = seg.lastChild as Text
    selectAcross(leading, 0, trailing, trailing.data.length)
    const pending = useReviewStore.getState().pendingMissedSelection
    expect(pending).not.toBeNull()
    expect(pending?.text).toBe('until May 13, 2027, unless')
    expect(pending?.text).not.toContain('DATE_PLACEHOLDER')
  })
})
