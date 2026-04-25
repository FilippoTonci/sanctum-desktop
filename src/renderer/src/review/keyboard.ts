import { useEffect, useRef } from 'react'
import { localActions, type ReviewActions } from './actions'
import { rangeToLocator } from './segments'
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
export function useReviewKeyboard(
  enabled: boolean,
  docRoot: HTMLElement | null,
  actions: ReviewActions,
): void {
  // Ref so the listener always reads the freshest actions without
  // re-attaching itself on every render — useful because actions
  // re-build every time the synced session id changes.
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    if (!enabled) return undefined

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (event.altKey) return

      // Ctrl/Cmd-Enter is the explicit commit shortcut. Routed before the
      // input-suspension check so it works even from within the operator
      // <select>; lots of users keep their hands on the keyboard during
      // review and would otherwise have to mouse-click out before
      // submitting.
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        useReviewStore.getState().openCommitPanel()
        event.preventDefault()
        return
      }

      // Other modifier combos pass through unchanged so browser shortcuts
      // (Cmd+R, Cmd+W, …) keep working.
      if (event.metaKey || event.ctrlKey) return
      if (isInputFocused(event.target)) return

      const handled = dispatchKey(event.key, useReviewStore.getState(), docRoot, actionsRef.current)
      if (handled) event.preventDefault()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [enabled, docRoot])
}

/**
 * Pure dispatcher: maps a key name onto a store action. Returns `true`
 * iff the key was bound (so callers can decide whether to preventDefault).
 *
 * Extracted from the hook so unit tests can exercise the binding table
 * without spinning up a DOM + event loop.
 */
export function dispatchKey(
  key: string,
  store: ReviewState,
  docRoot: HTMLElement | null = null,
  actions: ReviewActions = localActions,
): boolean {
  // While select-mode is active, the only bindings are Enter (commit
  // the selection) and Escape (cancel). Everything else passes through
  // so the user can still scroll, reach standard browser shortcuts, etc.
  if (store.selectMode) {
    if (key === 'Enter') {
      const span = readSelection(docRoot)
      if (span === null) return false
      actions.addMissed(span)
      return true
    }
    if (key === 'Escape') {
      store.exitSelectMode()
      return true
    }
    return false
  }

  switch (key) {
    case 'j':
      store.focusNext()
      return true
    case 'k':
      store.focusPrev()
      return true
    case 'a':
      if (store.focusedId === null) return false
      actions.accept(store.focusedId)
      return true
    case 'r':
      if (store.focusedId === null) return false
      actions.reject(store.focusedId)
      return true
    case 'u':
      if (store.undoStack.length === 0) return false
      actions.undoLastDecision()
      return true
    case 'm':
      store.enterSelectMode()
      return true
    case 'e':
      if (store.focusedId === null) return false
      store.startEditingReplacement(store.focusedId)
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
 * Read the current document selection and project it onto a locator.
 * Returns null if there is no selection, the selection lies outside
 * the docx body, the selection straddles two segments, or the captured
 * text is empty.
 */
function readSelection(docRoot: HTMLElement | null): {
  readonly locator: NonNullable<ReturnType<typeof rangeToLocator>>
  readonly text: string
} | null {
  if (docRoot === null) return null
  const selection = docRoot.ownerDocument.defaultView?.getSelection()
  if (selection === null || selection === undefined || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!docRoot.contains(range.commonAncestorContainer)) return null
  const locator = rangeToLocator(range, docRoot)
  if (locator === null) return null
  const text = range.toString()
  if (text.length === 0) return null
  return { locator, text }
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
