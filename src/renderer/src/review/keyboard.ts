import { useEffect } from 'react'
import { useReviewStore, type ReviewState } from './store'

/**
 * Bind the review-surface keyboard map. Suspended whenever an input,
 * textarea, or contenteditable region holds focus — so a user typing
 * in a future "edit replacement" field cannot accidentally accept the
 * detection underneath the modal.
 *
 * The set of bindings is derived from README §⌨️ Keyboard Reference.
 * Only the verdict + navigation + undo + dismiss subset lives in this
 * slice. `e` (edit replacement) and `m` (mark missed) wait for slices
 * 7 and 8 — adding them later just means another case in `dispatchKey`.
 */
export function useReviewKeyboard(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isInputFocused(event.target)) return

      const handled = dispatchKey(event.key, useReviewStore.getState())
      if (handled) event.preventDefault()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [enabled])
}

/**
 * Pure dispatcher: maps a key name onto a store action. Returns `true`
 * iff the key was bound (so callers can decide whether to preventDefault).
 *
 * Extracted from the hook so unit tests can exercise the binding table
 * without spinning up a DOM + event loop.
 */
export function dispatchKey(key: string, store: ReviewState): boolean {
  switch (key) {
    case 'j':
      store.focusNext()
      return true
    case 'k':
      store.focusPrev()
      return true
    case 'a':
      if (store.focusedId === null) return false
      store.setStatus(store.focusedId, 'accepted')
      return true
    case 'r':
      if (store.focusedId === null) return false
      store.setStatus(store.focusedId, 'rejected')
      return true
    case 'u':
      if (store.undoStack.length === 0) return false
      store.undoLastDecision()
      return true
    case 'Escape':
      if (store.focusedId === null) return false
      store.setFocused(null)
      return true
    default:
      return false
  }
}

/**
 * Treat the bindings as suspended whenever the user is typing somewhere.
 * Anchored on the event target rather than `document.activeElement` so a
 * future modal that lives inside a portal still suppresses correctly.
 */
export function isInputFocused(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}
