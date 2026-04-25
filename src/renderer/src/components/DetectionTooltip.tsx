import { autoUpdate, offset, shift, useFloating } from '@floating-ui/react'
import { useEffect, useMemo, type ReactElement } from 'react'
import { findSegmentRange } from '../review/segments'
import { useReviewStore } from '../review/store'
import type { Detection } from '../review/types'

interface DetectionTooltipProps {
  /** The DocxView body element; tooltip positions against ranges inside it. */
  readonly anchorRoot: HTMLElement | null
}

export function DetectionTooltip({ anchorRoot }: DetectionTooltipProps): ReactElement | null {
  const focusedId = useReviewStore((s) => s.focusedId)
  const detections = useReviewStore((s) => s.detections)
  const setStatus = useReviewStore((s) => s.setStatus)

  const focused = useMemo(
    () => detections.find((d) => d.id === focusedId) ?? null,
    [detections, focusedId],
  )

  const virtualReference = useMemo(
    () => buildVirtualReference(anchorRoot, focused),
    [anchorRoot, focused],
  )

  const { refs, floatingStyles, update } = useFloating({
    placement: 'top',
    middleware: [offset(10), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  useEffect(() => {
    refs.setReference(virtualReference)
  }, [refs, virtualReference])

  useEffect(() => {
    if (virtualReference !== null) update()
  }, [update, virtualReference, focused])

  if (focused === null || virtualReference === null) return null

  return (
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className="detection-tooltip"
      role="dialog"
      aria-label={`Detection: ${focused.entityType}`}
      data-testid="detection-tooltip"
    >
      <div className="detection-tooltip-header">
        <span className="detection-tooltip-entity">{focused.entityType}</span>
        <span className="detection-tooltip-status">{focused.status}</span>
      </div>
      <p className="detection-tooltip-text">"{focused.text}"</p>
      <div className="detection-tooltip-actions">
        <button
          type="button"
          className="detection-tooltip-accept"
          onClick={() => {
            setStatus(focused.id, 'accepted')
          }}
        >
          Accept
        </button>
        <button
          type="button"
          className="detection-tooltip-reject"
          onClick={() => {
            setStatus(focused.id, 'rejected')
          }}
        >
          Reject
        </button>
      </div>
    </div>
  )
}

interface VirtualElement {
  getBoundingClientRect: () => DOMRect
}

function buildVirtualReference(
  root: HTMLElement | null,
  detection: Detection | null,
): VirtualElement | null {
  if (root === null || detection === null) return null
  const range = findSegmentRange(root, {
    segmentId: detection.segmentId,
    start: detection.start,
    end: detection.end,
  })
  if (range === null) return null
  return {
    getBoundingClientRect: () => range.getBoundingClientRect(),
  }
}
