// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { dispatchKey, isInputFocused } from '../../../src/renderer/src/review/keyboard'
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

describe('dispatchKey', () => {
  beforeEach(() => {
    useReviewStore.getState().clear()
  })

  it('j focuses next, k focuses prev', () => {
    useReviewStore.getState().setDetections([makeDetection('a'), makeDetection('b')])
    expect(useReviewStore.getState().focusedId).toBe('a')

    expect(dispatchKey('j', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().focusedId).toBe('b')

    expect(dispatchKey('k', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().focusedId).toBe('a')
  })

  it('a / r set status of the focused detection only when one is focused', () => {
    useReviewStore.getState().setDetections([makeDetection('a'), makeDetection('b')])

    expect(dispatchKey('a', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().detections[0]?.status).toBe('accepted')

    useReviewStore.getState().setFocused('b')
    expect(dispatchKey('r', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().detections[1]?.status).toBe('rejected')
  })

  it('a / r are no-ops with no focused detection', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    useReviewStore.getState().setFocused(null)
    expect(dispatchKey('a', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('r', useReviewStore.getState())).toBe(false)
  })

  it('u reverses the most recent verdict and restores focus to it', () => {
    useReviewStore.getState().setDetections([makeDetection('a'), makeDetection('b')])
    dispatchKey('a', useReviewStore.getState()) // accept "a"
    useReviewStore.getState().setFocused('b')
    dispatchKey('r', useReviewStore.getState()) // reject "b"

    expect(dispatchKey('u', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().detections[1]?.status).toBe('pending')
    expect(useReviewStore.getState().focusedId).toBe('b')

    expect(dispatchKey('u', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().detections[0]?.status).toBe('pending')
  })

  it('u returns false when the undo stack is empty', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    expect(dispatchKey('u', useReviewStore.getState())).toBe(false)
  })

  it('Escape clears focus only when something is focused', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    expect(dispatchKey('Escape', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().focusedId).toBeNull()
    expect(dispatchKey('Escape', useReviewStore.getState())).toBe(false)
  })

  it('returns false for unbound keys', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    expect(dispatchKey('z', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('Tab', useReviewStore.getState())).toBe(false)
  })

  it('repeated accepts on the same detection do not balloon the undo stack', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    dispatchKey('a', useReviewStore.getState()) // pending → accepted, push edit
    dispatchKey('a', useReviewStore.getState()) // already accepted, no-op
    expect(useReviewStore.getState().undoStack).toHaveLength(1)
  })

  it('m enters select-mode', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    expect(dispatchKey('m', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().selectMode).toBe(true)
  })

  it('inside select-mode, j / a / r / k / u are inert and pass through', () => {
    useReviewStore.getState().setDetections([makeDetection('a'), makeDetection('b')])
    useReviewStore.getState().enterSelectMode()
    expect(dispatchKey('j', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('a', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('r', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('u', useReviewStore.getState())).toBe(false)
    // verdicts unchanged
    expect(useReviewStore.getState().detections[0]?.status).toBe('pending')
    expect(useReviewStore.getState().focusedId).toBe('a')
  })

  it('Escape exits select-mode without clearing focus', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    useReviewStore.getState().enterSelectMode()
    expect(dispatchKey('Escape', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().selectMode).toBe(false)
    expect(useReviewStore.getState().focusedId).toBe('a')
  })

  it('Enter inside select-mode commits the current selection when one exists', () => {
    document.body.innerHTML =
      '<div id="root"><span data-segment-id="body/p0/r0">Hello, Smith!</span></div>'
    const root = document.getElementById('root')!
    const seg = root.querySelector('[data-segment-id]')!.firstChild as Text
    const range = document.createRange()
    range.setStart(seg, 7) // "Smith"
    range.setEnd(seg, 12)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    useReviewStore.getState().setDetections([])
    useReviewStore.getState().enterSelectMode()

    expect(dispatchKey('Enter', useReviewStore.getState(), root)).toBe(true)

    const state = useReviewStore.getState()
    expect(state.selectMode).toBe(false)
    expect(state.detections).toHaveLength(1)
    expect(state.detections[0]?.text).toBe('Smith')
    expect(state.detections[0]?.entityType).toBe('USER_ADDED')
  })

  it('Enter inside select-mode is a no-op when nothing is selected', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = document.getElementById('root')!
    window.getSelection()?.removeAllRanges()

    useReviewStore.getState().enterSelectMode()
    expect(dispatchKey('Enter', useReviewStore.getState(), root)).toBe(false)
    expect(useReviewStore.getState().selectMode).toBe(true)
  })
})

describe('isInputFocused', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('returns true for input, textarea, select, and contenteditable', () => {
    document.body.innerHTML = `
      <input id="i" />
      <textarea id="t"></textarea>
      <select id="s"><option>x</option></select>
      <div id="c" contenteditable="true">x</div>
      <p id="p">no</p>
    `
    expect(isInputFocused(document.getElementById('i'))).toBe(true)
    expect(isInputFocused(document.getElementById('t'))).toBe(true)
    expect(isInputFocused(document.getElementById('s'))).toBe(true)
    expect(isInputFocused(document.getElementById('c'))).toBe(true)
    expect(isInputFocused(document.getElementById('p'))).toBe(false)
  })

  it('returns false for non-element targets and null', () => {
    expect(isInputFocused(null)).toBe(false)
    expect(isInputFocused(document)).toBe(false)
  })
})
