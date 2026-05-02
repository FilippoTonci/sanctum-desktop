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

  it('ArrowDown focuses next, ArrowUp focuses prev', () => {
    useReviewStore.getState().setDetections([makeDetection('a'), makeDetection('b')])
    expect(useReviewStore.getState().focusedId).toBe('a')

    expect(dispatchKey('ArrowDown', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().focusedId).toBe('b')

    expect(dispatchKey('ArrowUp', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().focusedId).toBe('a')
  })

  it('arrow nav returns false on an empty list (so no preventDefault swallows the key)', () => {
    expect(dispatchKey('ArrowDown', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('ArrowUp', useReviewStore.getState())).toBe(false)
  })

  it('Enter accepts the focused detection and auto-advances to the next pending one', () => {
    useReviewStore
      .getState()
      .setDetections([makeDetection('a'), makeDetection('b'), makeDetection('c')])

    expect(dispatchKey('Enter', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().detections[0]?.status).toBe('accepted')
    // Auto-advance lands on the next pending entry.
    expect(useReviewStore.getState().focusedId).toBe('b')
  })

  it('Delete and Backspace both reject the focused detection and auto-advance', () => {
    useReviewStore
      .getState()
      .setDetections([makeDetection('a'), makeDetection('b'), makeDetection('c')])

    expect(dispatchKey('Delete', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().detections[0]?.status).toBe('rejected')
    expect(useReviewStore.getState().focusedId).toBe('b')

    expect(dispatchKey('Backspace', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().detections[1]?.status).toBe('rejected')
    expect(useReviewStore.getState().focusedId).toBe('c')
  })

  it('auto-advance skips detections that are already accepted/rejected', () => {
    useReviewStore
      .getState()
      .setDetections([
        makeDetection('a'),
        makeDetection('b', { status: 'accepted' }),
        makeDetection('c', { status: 'rejected' }),
        makeDetection('d'),
      ])

    expect(dispatchKey('Enter', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().detections[0]?.status).toBe('accepted')
    // Skips already-decided 'b' and 'c', lands on the next pending 'd'.
    expect(useReviewStore.getState().focusedId).toBe('d')
  })

  it('auto-advance leaves focus put when no other pending detections remain', () => {
    useReviewStore
      .getState()
      .setDetections([
        makeDetection('a'),
        makeDetection('b', { status: 'accepted' }),
        makeDetection('c', { status: 'rejected' }),
      ])

    expect(dispatchKey('Enter', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().detections[0]?.status).toBe('accepted')
    // No remaining pending detection — focus stays on the one we just decided.
    expect(useReviewStore.getState().focusedId).toBe('a')
  })

  it('auto-advance wraps backwards to a pending detection earlier in the list', () => {
    useReviewStore.getState().setDetections([makeDetection('a'), makeDetection('b')])
    useReviewStore.getState().setFocused('b')

    expect(dispatchKey('Enter', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().detections[1]?.status).toBe('accepted')
    expect(useReviewStore.getState().focusedId).toBe('a')
  })

  it('Enter / Delete are no-ops with no focused detection', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    useReviewStore.getState().setFocused(null)
    expect(dispatchKey('Enter', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('Delete', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('Backspace', useReviewStore.getState())).toBe(false)
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
    // Tab is handled at the hook level (focus-scoped), not in the
    // pure dispatcher — so the dispatcher itself reports it unbound.
    expect(dispatchKey('Tab', useReviewStore.getState())).toBe(false)
    // Old j/k/a/r/u bindings are gone — they should report as unbound.
    expect(dispatchKey('j', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('k', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('a', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('r', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('u', useReviewStore.getState())).toBe(false)
  })

  it('repeated accepts on the same detection do not balloon the undo stack', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    dispatchKey('Enter', useReviewStore.getState()) // pending → accepted, push edit
    // After auto-advance, focus moved away; bring it back to retry.
    useReviewStore.getState().setFocused('a')
    dispatchKey('Enter', useReviewStore.getState()) // already accepted, no-op
    expect(useReviewStore.getState().undoStack).toHaveLength(1)
  })

  it('m enters select-mode', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    expect(dispatchKey('m', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().selectMode).toBe(true)
  })

  it('inside select-mode, navigation and verdict keys are inert and pass through', () => {
    useReviewStore.getState().setDetections([makeDetection('a'), makeDetection('b')])
    useReviewStore.getState().enterSelectMode()
    expect(dispatchKey('ArrowDown', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('ArrowUp', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('Delete', useReviewStore.getState())).toBe(false)
    expect(dispatchKey('Backspace', useReviewStore.getState())).toBe(false)
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

  it('e opens the replacement editor on the focused detection', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    expect(dispatchKey('e', useReviewStore.getState())).toBe(true)
    expect(useReviewStore.getState().editingReplacementId).toBe('a')
  })

  it('e is a no-op with no focused detection', () => {
    useReviewStore.getState().setDetections([makeDetection('a')])
    useReviewStore.getState().setFocused(null)
    expect(dispatchKey('e', useReviewStore.getState())).toBe(false)
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
