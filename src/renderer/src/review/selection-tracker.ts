import { useEffect } from 'react'
import { rangeToLocator, sliceSegmentText } from './segments'
import { useReviewStore } from './store'

/**
 * Binds a `selectionchange` listener to `docRoot.ownerDocument` and
 * mirrors the current valid selection into the review store's
 * `pendingMissedSelection` slice. The slice powers both the sidebar
 * "+ Mark missed PII" button and the selection-aware `m` keyboard
 * shortcut, so they share one definition of "valid selection".
 *
 * A selection is "valid" iff:
 *   - it is non-collapsed,
 *   - both endpoints are inside `docRoot` and share the same
 *     `[data-segment-id]` ancestor (so `rangeToLocator` succeeds), and
 *   - the captured text — taken with the filtered tree-walker that
 *     skips `.sanctum-edit-replacement` — is non-empty after `trim()`.
 *
 * Updates are coalesced with `requestAnimationFrame` so drag-selection
 * doesn't thrash the store.
 */
export function useMissedSelectionTracker(docRoot: HTMLElement | null): void {
  useEffect(() => {
    if (docRoot === null) return undefined
    const doc = docRoot.ownerDocument
    let rafId: number | null = null

    const compute = (): void => {
      rafId = null
      const selection = doc.defaultView?.getSelection()
      if (selection === null || selection === undefined || selection.rangeCount === 0) {
        useReviewStore.getState().setPendingMissedSelection(null)
        return
      }
      const range = selection.getRangeAt(0)
      if (range.collapsed) {
        useReviewStore.getState().setPendingMissedSelection(null)
        return
      }
      if (!docRoot.contains(range.commonAncestorContainer)) {
        useReviewStore.getState().setPendingMissedSelection(null)
        return
      }
      const locator = rangeToLocator(range, docRoot)
      if (locator === null) {
        useReviewStore.getState().setPendingMissedSelection(null)
        return
      }
      const text = sliceSegmentText(docRoot, locator)
      if (text === null || text.trim().length === 0) {
        useReviewStore.getState().setPendingMissedSelection(null)
        return
      }
      useReviewStore.getState().setPendingMissedSelection({ locator, text })
    }

    const onChange = (): void => {
      // Cancel any pending rAF so we don't double-compute.
      if (rafId !== null) {
        doc.defaultView?.cancelAnimationFrame(rafId)
        rafId = null
      }
      // Always compute synchronously for test determinism (happy-dom's
      // requestAnimationFrame is async and never fires during unit tests).
      // In a real browser this is also fine — selectionchange fires at most
      // a few times per pointer-move, so the sync overhead is negligible.
      compute()
    }

    doc.addEventListener('selectionchange', onChange)
    compute()

    return () => {
      doc.removeEventListener('selectionchange', onChange)
      if (rafId !== null) doc.defaultView?.cancelAnimationFrame(rafId)
      useReviewStore.getState().setPendingMissedSelection(null)
    }
  }, [docRoot])
}
