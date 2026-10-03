import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { SessionsClient } from '../api/sessions'
import type { LayoutUnscanned, ReviewSessionLayout } from '../api/types'
import {
  cloneForThumbnail,
  fitTextboxes,
  renderPptxLayout,
  slideIndexOfSegment,
} from '../review/pptx-render'
import type { Detection } from '../review/types'
import { useReviewSurface } from '../review/use-review-surface'
import { Icon } from './Icon'

interface PptxViewProps {
  readonly detections: readonly Detection[]
  readonly focusedId: string | null
  readonly onRendered?: (root: HTMLElement) => void
  readonly onFocusDetection?: (id: string) => void
  readonly onUnwrappable?: (ids: readonly string[]) => void
  /** Layout comes from the engine, so the view needs a live session. */
  readonly client: SessionsClient | null
  readonly sessionId: string | null
}

type RenderState =
  | { kind: 'waiting' }
  | { kind: 'rendering' }
  | { kind: 'ready'; layout: ReviewSessionLayout }
  | { kind: 'error'; message: string }

/**
 * PowerPoint review canvas. Slides are drawn from the engine's `/layout`
 * as absolutely positioned HTML (see `review/pptx-render.ts`); every run
 * carries `data-segment-id`, so the highlight / wrap / keyboard / commit
 * machinery is the docx one. A thumbnail rail on the canvas's left edge
 * jumps between slides and shows how many findings each still has.
 */
export function PptxView({
  detections,
  focusedId,
  onRendered,
  onFocusDetection,
  onUnwrappable,
  client,
  sessionId,
}: PptxViewProps): ReactElement {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const railRef = useRef<HTMLElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<RenderState>({ kind: 'waiting' })
  // Held in a ref: App rebuilds onRendered when the analysis state flips,
  // and re-rendering the deck for that would throw away the wraps.
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  useEffect(() => {
    const host = bodyRef.current
    if (host === null) return undefined
    if (client === null || sessionId === null) {
      setState({ kind: 'waiting' })
      return undefined
    }
    const ctrl = new AbortController()
    setState({ kind: 'rendering' })
    void (async () => {
      try {
        const layout = await client.getLayout(sessionId, ctrl.signal)
        if (ctrl.signal.aborted) return
        renderPptxLayout(host, layout)
        fitTextboxes(host)
        setState({ kind: 'ready', layout })
        onRenderedRef.current?.(host)
      } catch (err) {
        if (ctrl.signal.aborted) return
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      ctrl.abort()
      host.replaceChildren()
    }
  }, [client, sessionId])

  // Fonts can land after the first fit pass and change line wrapping.
  useEffect(() => {
    if (state.kind !== 'ready') return
    const host = bodyRef.current
    if (host === null) return
    // `fonts` is missing under happy-dom; typed optional on purpose.
    const fonts = (host.ownerDocument as { fonts?: FontFaceSet }).fonts
    void fonts?.ready.then(() => {
      fitTextboxes(host)
    })
  }, [state.kind])

  useReviewSurface({
    hostRef: bodyRef,
    ready: state.kind === 'ready',
    detections,
    focusedId,
    onFocusDetection,
    onUnwrappable,
  })

  // Keep the focused detection on screen — slides are tall, and arrow
  // keys can jump several slides at once.
  useEffect(() => {
    if (state.kind !== 'ready' || focusedId === null) return
    const host = bodyRef.current
    const scroller = scrollRef.current
    if (host === null || scroller === null) return
    for (const el of host.querySelectorAll<HTMLElement>('[data-detection-id]')) {
      if (el.getAttribute('data-detection-id') === focusedId) {
        scrollWithin(scroller, el, 'nearest')
        return
      }
    }
  }, [state.kind, focusedId])

  // Thumbnails: static clones of the rendered slides, segment ids stripped.
  useEffect(() => {
    if (state.kind !== 'ready') return
    const host = bodyRef.current
    const rail = railRef.current
    if (host === null || rail === null) return
    for (const frame of host.querySelectorAll<HTMLElement>('.pptx-slide-frame')) {
      const slide = frame.querySelector<HTMLElement>('.pptx-slide')
      const thumb = rail.querySelector<HTMLElement>(
        `.pptx-thumb[data-slide-index="${frame.dataset.slideIndex ?? ''}"]`,
      )
      if (slide !== null && thumb !== null) thumb.replaceChildren(cloneForThumbnail(slide))
    }
  }, [state])

  const perSlide = useMemo(() => countBySlide(detections), [detections])
  const focusedSlide = useMemo(() => {
    const d = detections.find((x) => x.id === focusedId)
    return d === undefined ? null : slideIndexOfSegment(d.segmentId)
  }, [detections, focusedId])

  const scrollToSlide = (index: number): void => {
    const frame = bodyRef.current?.querySelector<HTMLElement>(
      `.pptx-slide-frame[data-slide-index="${String(index)}"]`,
    )
    const scroller = scrollRef.current
    if (frame !== null && frame !== undefined && scroller !== null) {
      scrollWithin(scroller, frame, 'start')
    }
  }

  const pages = state.kind === 'ready' ? state.layout.pages : []
  const unscanned = state.kind === 'ready' ? (state.layout.unscanned ?? []) : []

  return (
    <section
      className="canvas pptx-canvas"
      aria-busy={state.kind !== 'ready'}
      aria-label="Presentation"
    >
      {state.kind === 'waiting' && client === null ? (
        <p className="canvas-status is-error" role="alert">
          PowerPoint review needs the Sanctum engine, which is not running.
        </p>
      ) : null}
      {state.kind === 'rendering' ? (
        <p className="canvas-status" role="status">
          <span className="spinner" aria-hidden="true" />
          Rendering slides…
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p className="canvas-status is-error" role="alert">
          Could not render this presentation: {state.message}
        </p>
      ) : null}
      <div className="pptx-split">
        {pages.length > 0 ? (
          <nav className="pptx-rail" aria-label="Slides" ref={railRef}>
            {pages.map((page) => {
              const counts = perSlide.get(page.index)
              return (
                <button
                  key={page.index}
                  type="button"
                  className={`pptx-rail-item${focusedSlide === page.index ? ' is-active' : ''}`}
                  onClick={() => {
                    scrollToSlide(page.index)
                  }}
                  title={`Go to slide ${String(page.index + 1)}`}
                >
                  <span className="pptx-rail-number">{String(page.index + 1)}</span>
                  <span
                    className="pptx-thumb"
                    data-slide-index={String(page.index)}
                    style={{ aspectRatio: `${String(page.width)} / ${String(page.height)}` }}
                  />
                  {counts !== undefined ? (
                    <span
                      className={`pptx-rail-badge${counts.pending > 0 ? ' is-pending' : ''}`}
                      title={`${String(counts.pending)} to review of ${String(counts.total)}`}
                    >
                      {counts.pending > 0 ? (
                        String(counts.pending)
                      ) : (
                        <Icon name="check" size={10} />
                      )}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </nav>
        ) : null}
        <div ref={scrollRef} className="canvas-scroll pptx-scroll">
          {unscanned.length > 0 ? <UnscannedNotice items={unscanned} /> : null}
          <div ref={bodyRef} className="pptx-view-body" data-testid="pptx-body" />
        </div>
      </div>
    </section>
  )
}

function UnscannedNotice({ items }: { readonly items: readonly LayoutUnscanned[] }): ReactElement {
  return (
    <details className="pptx-unscanned" data-testid="pptx-unscanned">
      <summary>
        {String(items.length)} part{items.length === 1 ? '' : 's'} of this presentation{' '}
        {items.length === 1 ? 'is' : 'are'} not scanned. Check {items.length === 1 ? 'it' : 'them'}{' '}
        by hand.
      </summary>
      <ul>
        {items.map((u, i) => (
          <li key={i}>
            <strong>{u.where}:</strong> {u.what}
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * Scroll only the canvas scroller. `scrollIntoView` also scrolls every
 * scrollable ancestor, which can push the review toolbar off screen.
 */
function scrollWithin(scroller: HTMLElement, el: HTMLElement, align: 'start' | 'nearest'): void {
  const box = scroller.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const margin = 24
  let delta: number
  if (align === 'start') delta = r.top - box.top - margin
  else if (r.top < box.top + margin) delta = r.top - box.top - margin
  else if (r.bottom > box.bottom - margin) delta = r.bottom - box.bottom + margin
  else return
  if (typeof scroller.scrollBy === 'function') scroller.scrollBy({ top: delta, behavior: 'smooth' })
}

function countBySlide(
  detections: readonly Detection[],
): Map<number, { total: number; pending: number }> {
  const out = new Map<number, { total: number; pending: number }>()
  for (const d of detections) {
    const idx = slideIndexOfSegment(d.segmentId)
    if (idx === null) continue
    const c = out.get(idx) ?? { total: 0, pending: 0 }
    c.total += 1
    if (d.status === 'pending') c.pending += 1
    out.set(idx, c)
  }
  return out
}
