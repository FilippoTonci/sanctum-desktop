import { useEffect, useRef } from 'react'
import { localActions, type ReviewActions } from './actions'
import { useReviewStore, type ReviewState } from './store'

/**
 * Bind the review-surface keyboard map. Suspended whenever an input,
 * textarea, or contenteditable region holds focus — so a user typing
 * in the "edit replacement" field cannot accidentally accept the
 * detection underneath the modal.
 *
 * The set of bindings is derived from README §⌨️ Keyboard Reference.
 *
 * Tab / Shift+Tab are intercepted only when no specific element holds
 * focus (i.e. the document body is the active element). That keeps
 * native focus traversal alive whenever the user is tabbing through
 * the sidebar buttons / commit panel / settings, but lets Tab act as
 * "next detection" while the review surface is the ambient context.
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

      // Ctrl/Cmd-Z is the undo shortcut. Suspended while typing so the
      // browser's native input-undo still works inside the replacement
      // editor.
      if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
        if (isInputFocused(event.target)) return
        if (useReviewStore.getState().undoStack.length === 0) return
        actionsRef.current.undoLastDecision()
        event.preventDefault()
        return
      }

      // Other modifier combos pass through unchanged so browser shortcuts
      // (Cmd+R, Cmd+W, …) keep working.
      if (event.metaKey || event.ctrlKey) return
      if (isInputFocused(event.target)) return

      // Tab navigation is gated on the review surface owning focus
      // (i.e. nothing more specific is focused). Without this gate we'd
      // hijack Tab inside the sidebar / settings modal / commit panel
      // and break native focus traversal.
      if (event.key === 'Tab') {
        if (event.target !== document.body) return
        const store = useReviewStore.getState()
        if (store.detections.length === 0) return
        if (event.shiftKey) {
          store.focusPrev()
        } else {
          store.focusNext()
        }
        event.preventDefault()
        return
      }
      const handled = dispatchKey(event.key, useReviewStore.getState(), actionsRef.current)
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
 * without spinning up a DOM + event loop. The hook above handles the
 * modifier-bearing shortcuts (Ctrl/Cmd+Enter, Ctrl/Cmd+Z) and the
 * focus-scoped Tab traversal; everything in here is the un-modified
 * key map that runs whenever the review surface owns the keyboard.
 */
export function dispatchKey(
  key: string,
  store: ReviewState,
  actions: ReviewActions = localActions,
): boolean {
  switch (key) {
    case 'ArrowDown':
      if (store.detections.length === 0) return false
      store.focusNext()
      return true
    case 'ArrowUp':
      if (store.detections.length === 0) return false
      store.focusPrev()
      return true
    case 'Enter':
      // Accept + auto-advance to the next pending detection. Picking
      // the next pending entry (rather than the next-by-index) keeps
      // the user moving forward through outstanding work without
      // re-visiting items they already decided.
      if (store.focusedId === null) return false
      actions.accept(store.focusedId)
      useReviewStore.getState().focusNextPending()
      return true
    case 'Delete':
    case 'Backspace':
      if (store.focusedId === null) return false
      actions.reject(store.focusedId)
      useReviewStore.getState().focusNextPending()
      return true
    case 'm': {
      const pending = store.pendingMissedSelection
      if (pending === null) return false
      actions.addMissed(pending)
      return true
    }
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
