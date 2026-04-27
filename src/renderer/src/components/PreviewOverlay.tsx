import { autoUpdate, offset, shift, useFloating } from '@floating-ui/react'
import { useEffect, useMemo, type ReactElement } from 'react'
import { findSegmentRange } from '../review/segments'
import { useReviewStore } from '../review/store'
import type { Detection } from '../review/types'

interface PreviewOverlayProps {
  /** The DocxView body element; bubbles position against ranges inside it. */
  readonly anchorRoot: HTMLElement | null
}

/**
 * Render the backend-computed preview text as ghost-text bubbles next to
 * each accepted detection. The preview map is sourced from the session
 * response and updated by every PATCH/POST that touches a decision (see
 * `review/actions.ts::recordPreview`).
 *
 * Only accepted detections are surfaced here. Pending detections could
 * also show a "what would happen if accepted" preview using the session
 * default operator — possible future polish, but starts noisy on a
 * fresh document where every detection is pending.
 *
 * Rejected detections preview as the original text verbatim per the
 * backend's preview rules; rendering that next to the highlighted
 * (rejected) span is just visual duplication, so we skip it.
 *
 * Standalone fake mode never populates the preview map, so this
 * component renders nothing in that path. Documented limitation.
 */
export function PreviewOverlay({ anchorRoot }: PreviewOverlayProps): ReactElement | null {
  const detections = useReviewStore((s) => s.detections)
  const previews = useReviewStore((s) => s.previews)

  if (anchorRoot === null) return null

  const visible: { detection: Detection; preview: string }[] = []
  for (const detection of detections) {
    if (detection.status !== 'accepted') continue
    const preview = previews[detection.id]
    if (preview === undefined) continue
    visible.push({ detection, preview })
  }

  return (
    <>
      {visible.map(({ detection, preview }) => (
        <PreviewBubble
          key={detection.id}
          anchorRoot={anchorRoot}
          detection={detection}
          preview={preview}
        />
      ))}
    </>
  )
}

interface PreviewBubbleProps {
  readonly anchorRoot: HTMLElement
  readonly detection: Detection
  readonly preview: string
}

function PreviewBubble({
  anchorRoot,
  detection,
  preview,
}: PreviewBubbleProps): ReactElement | null {
  const virtualReference = useMemo(() => {
    const range = findSegmentRange(anchorRoot, {
      segmentId: detection.segmentId,
      start: detection.start,
      end: detection.end,
    })
    if (range === null) return null
    return { getBoundingClientRect: () => range.getBoundingClientRect() }
  }, [anchorRoot, detection])

  const { refs, floatingStyles } = useFloating({
    placement: 'right',
    middleware: [offset(8), shift({ padding: 4 })],
    whileElementsMounted: autoUpdate,
  })

  useEffect(() => {
    refs.setReference(virtualReference)
  }, [refs, virtualReference])

  if (virtualReference === null) return null

  return (
    <span
      ref={refs.setFloating}
      style={floatingStyles}
      className="preview-bubble"
      data-testid="preview-bubble"
      data-detection-id={detection.id}
      aria-hidden="true"
    >
      <span className="preview-bubble-arrow" aria-hidden="true">
        →
      </span>
      <span className="preview-bubble-text">{preview}</span>
    </span>
  )
}
