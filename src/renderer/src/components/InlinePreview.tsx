import { autoUpdate, offset, shift, useFloating } from '@floating-ui/react'
import { useEffect, useMemo, type ReactElement } from 'react'
import { findSegmentRange } from '../review/segments'
import { useReviewStore } from '../review/store'
import type { Detection, DetectionStatus } from '../review/types'

interface InlinePreviewProps {
  /** The DocxView body element; preview spans position against ranges inside it. */
  readonly anchorRoot: HTMLElement | null
}

export type PreviewVariant = 'faint' | 'firm'

/**
 * Decide whether a detection should render an inline preview, and at
 * what intensity. Pure helper, exported for unit testing.
 *
 *   accepted              → firm     (replacement materialises)
 *   pending && focused    → firm     (the one the reviewer is acting on)
 *   pending && !focused   → faint    (a calm "this is what we'd do")
 *   rejected | no preview → null     (nothing to show)
 */
export function pickPreviewVariant(
  detection: Detection,
  focusedId: string | null,
  preview: string | undefined,
): PreviewVariant | null {
  if (preview === undefined) return null
  const status: DetectionStatus = detection.status
  if (status === 'rejected') return null
  if (status === 'accepted') return 'firm'
  return detection.id === focusedId ? 'firm' : 'faint'
}

/**
 * Render the backend-computed preview text as a floating span next to
 * each detection that has one. The span is positioned with floating-ui
 * (placement="right") and absorbs what `PreviewOverlay` used to do for
 * accepted detections — this version handles every visible state.
 *
 * The preview map is sourced from the review store and updated by every
 * PATCH/POST that touches a decision (see `review/actions.ts::recordPreview`).
 *
 * Standalone fake mode never populates the preview map, so this
 * component renders nothing in that path. Documented limitation, same
 * as the old `PreviewOverlay`.
 */
export function InlinePreview({ anchorRoot }: InlinePreviewProps): ReactElement | null {
  const detections = useReviewStore((s) => s.detections)
  const focusedId = useReviewStore((s) => s.focusedId)
  const previews = useReviewStore((s) => s.previews)

  if (anchorRoot === null) return null

  const visible: { detection: Detection; preview: string; variant: PreviewVariant }[] = []
  for (const detection of detections) {
    const previewText = previews[detection.id]
    if (previewText === undefined) continue
    const variant = pickPreviewVariant(detection, focusedId, previewText)
    if (variant === null) continue
    visible.push({ detection, preview: previewText, variant })
  }

  return (
    <>
      {visible.map(({ detection, preview, variant }) => (
        <InlinePreviewSpan
          key={detection.id}
          anchorRoot={anchorRoot}
          detection={detection}
          preview={preview}
          variant={variant}
        />
      ))}
    </>
  )
}

interface InlinePreviewSpanProps {
  readonly anchorRoot: HTMLElement
  readonly detection: Detection
  readonly preview: string
  readonly variant: PreviewVariant
}

function InlinePreviewSpan({
  anchorRoot,
  detection,
  preview,
  variant,
}: InlinePreviewSpanProps): ReactElement | null {
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
    middleware: [offset(6), shift({ padding: 4 })],
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
      className={`inline-preview${variant === 'firm' ? ' inline-preview-firm' : ''}`}
      data-testid="inline-preview"
      data-detection-id={detection.id}
      data-variant={variant}
      aria-hidden="true"
    >
      {preview}
    </span>
  )
}
