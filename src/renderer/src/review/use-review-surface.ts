import { useEffect, type RefObject } from 'react'
import { detectionIdFromClick } from './click-focus'
import { wrapDetections } from './edit-wrap'
import { applyHighlightRegistries, resolveDetections } from './highlights'
import type { Detection } from './types'

/**
 * The format-agnostic half of a document view: once the host holds
 * rendered `[data-segment-id]` elements, wrap + highlight detections and
 * route clicks to focus. Same passes, same order as `DocxView` (which
 * predates this hook and still inlines them); `PptxView` uses the hook
 * so a future `PdfView` can too.
 */
export function useReviewSurface(args: {
  readonly hostRef: RefObject<HTMLElement | null>
  readonly ready: boolean
  readonly detections: readonly Detection[]
  readonly focusedId: string | null
  readonly onFocusDetection?: (id: string) => void
  readonly onUnwrappable?: (ids: readonly string[]) => void
}): void {
  const { hostRef, ready, detections, focusedId, onFocusDetection, onUnwrappable } = args

  useEffect(() => {
    if (!ready) return
    const host = hostRef.current
    if (host === null) return
    // Wrap first so highlight ranges are built against the stable wraps.
    const unwrappable = wrapDetections(host, detections)
    onUnwrappable?.(unwrappable)
    const resolved = resolveDetections(host, detections)
    applyHighlightRegistries(resolved, focusedId, detections)
  }, [hostRef, ready, detections, focusedId, onUnwrappable])

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return undefined
    if (onFocusDetection === undefined) return undefined

    const handleClick = (event: MouseEvent): void => {
      const collapsed = host.ownerDocument.defaultView?.getSelection()?.isCollapsed ?? true
      const id = detectionIdFromClick(event.target, collapsed)
      if (id !== null) onFocusDetection(id)
    }

    host.addEventListener('click', handleClick)
    return () => {
      host.removeEventListener('click', handleClick)
    }
  }, [hostRef, onFocusDetection])
}
