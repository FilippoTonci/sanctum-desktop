import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { SessionsClient } from '../api/sessions'
import type { ReviewSessionLayout } from '../api/types'
import {
  buildTextLayer,
  canvasMeasure,
  countByPage,
  pageIndexOfSegment,
  scaleForZoom,
  scaledLength,
  textlineBox,
  ZOOM_MODES,
  type ZoomMode,
} from '../review/pdf-layout'
import type { PDFDocumentProxy, RenderTask } from '../review/pdfjs'
import { headsOf, type Detection } from '../review/types'
import { useReviewSurface } from '../review/use-review-surface'
import { Icon } from './Icon'
import { scrollWithin, UnscannedNotice } from './PptxView'

interface PdfViewProps {
  readonly file: File
  readonly zoom: ZoomMode
  readonly detections: readonly Detection[]
  readonly focusedId: string | null
  readonly onRendered?: (root: HTMLElement) => void
  readonly onFocusDetection?: (id: string) => void
  readonly onUnwrappable?: (ids: readonly string[]) => void
  /** The text layer comes from the engine's `/layout`, so it needs a session. */
  readonly client: SessionsClient | null
  readonly sessionId: string | null
}

interface PageSize {
  readonly width: number
  readonly height: number
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; pdf: PDFDocumentProxy; sizes: readonly PageSize[] }
  | { kind: 'error'; message: string }

type LayoutState =
  | { kind: 'waiting' }
  | { kind: 'loading' }
  | { kind: 'ready'; layout: ReviewSessionLayout }
  | { kind: 'error'; message: string }

/** `.canvas-scroll` padding on both sides, subtracted for "fit width". */
const SCROLL_PADDING_PX = 48
/** Thumbnail width; detection marks on it use the same per-page mapping. */
const THUMB_WIDTH_PX = 84

const ZOOM_LABELS: Record<ZoomMode, string> = { fit: 'Fit', '100': '100%', '150': '150%' }

/**
 * Zoom control for the review toolbar's view slot. App owns the value so
 * the control can live in `ReviewToolbar` while PdfView applies it.
 */
export function PdfZoomControl({
  value,
  onChange,
}: {
  readonly value: ZoomMode
  readonly onChange: (mode: ZoomMode) => void
}): ReactElement {
  return (
    <div className="segmented pdf-zoom" role="radiogroup" aria-label="Zoom">
      {ZOOM_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          className="segmented-item"
          title={mode === 'fit' ? 'Fit page width' : `Zoom to ${ZOOM_LABELS[mode]}`}
          onClick={() => {
            onChange(mode)
          }}
        >
          {ZOOM_LABELS[mode]}
        </button>
      ))}
    </div>
  )
}

/**
 * PDF review canvas. Each page is a PDF.js raster with a transparent,
 * positioned text layer built from the engine's `/layout` textlines on
 * top (`review/pdf-layout.ts`). The layer carries `[data-segment-id]`
 * elements whose textContent equals the segment text, so the highlight /
 * wrap / keyboard / commit machinery is the docx one. A page rail on the
 * canvas's left edge jumps between pages.
 */
export function PdfView({
  file,
  zoom,
  detections,
  focusedId,
  onRendered,
  onFocusDetection,
  onUnwrappable,
  client,
  sessionId,
}: PdfViewProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stackRef = useRef<HTMLDivElement | null>(null)
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [layoutState, setLayoutState] = useState<LayoutState>({ kind: 'waiting' })
  const [availableWidth, setAvailableWidth] = useState(0)
  const [textReady, setTextReady] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  // Held in a ref: App rebuilds onRendered when the analysis state flips,
  // and rebuilding the text layer for that would throw away the wraps.
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  const layout = layoutState.kind === 'ready' ? layoutState.layout : null

  // ---- load the document (PDF.js, lazily imported) -----------------------
  useEffect(() => {
    // Object flags: mutated from the async body, which lint's control-flow
    // analysis cannot see through (same pattern as DocxView).
    const ctrl: { cancelled: boolean; loaded: PDFDocumentProxy | null } = {
      cancelled: false,
      loaded: null,
    }
    const isCancelled = (): boolean => ctrl.cancelled
    setLoad({ kind: 'loading' })
    void (async () => {
      try {
        const [{ loadPdf }, buffer] = await Promise.all([
          import('../review/pdfjs'),
          file.arrayBuffer(),
        ])
        if (isCancelled()) return
        const pdf = await loadPdf(buffer)
        ctrl.loaded = pdf
        if (isCancelled()) {
          void pdf.loadingTask.destroy()
          return
        }
        const sizes: PageSize[] = []
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const vp = page.getViewport({ scale: 1 })
          sizes.push({ width: vp.width, height: vp.height })
        }
        if (!isCancelled()) setLoad({ kind: 'ready', pdf, sizes })
      } catch (err) {
        if (!isCancelled())
          setLoad({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      ctrl.cancelled = true
      if (ctrl.loaded !== null) void ctrl.loaded.loadingTask.destroy()
    }
  }, [file])

  // ---- fetch the engine text layer ----------------------------------------
  useEffect(() => {
    if (client === null || sessionId === null) {
      setLayoutState({ kind: 'waiting' })
      return undefined
    }
    const ctrl = new AbortController()
    setLayoutState({ kind: 'loading' })
    void (async () => {
      try {
        const next = await client.getLayout(sessionId, ctrl.signal)
        if (!ctrl.signal.aborted) setLayoutState({ kind: 'ready', layout: next })
      } catch (err) {
        if (ctrl.signal.aborted) return
        setLayoutState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })()
    return () => {
      ctrl.abort()
    }
  }, [client, sessionId])

  // Page geometry: the layout is authoritative for the text layer, so its
  // page boxes win; PDF.js sizes cover the time before it arrives. Each
  // page keeps its own size (mixed A4 / Letter documents).
  const pageSizes = useMemo<readonly PageSize[]>(() => {
    if (load.kind !== 'ready') return []
    return load.sizes.map((s, i) => {
      const lp = layout?.pages.find((p) => p.index === i)
      return lp !== undefined ? { width: lp.width, height: lp.height } : s
    })
  }, [load, layout])

  const widest = useMemo(() => pageSizes.reduce((m, p) => Math.max(m, p.width), 0), [pageSizes])
  const scale = scaleForZoom(zoom, availableWidth - SCROLL_PADDING_PX, widest)

  // ---- track available width for "fit width" -----------------------------
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return undefined
    const update = (): void => {
      setAvailableWidth(el.clientWidth)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [load.kind])

  // ---- text layer ----------------------------------------------------------
  // Built imperatively into empty host <div>s React never reconciles, so
  // the `.sanctum-edit` wraps edit-wrap.ts inserts survive re-renders and
  // zoom (zoom only changes --pdf-scale).
  const pageCount = pageSizes.length
  useEffect(() => {
    const stack = stackRef.current
    if (stack === null || layout === null || pageCount === 0) {
      setTextReady(false)
      return
    }
    const measure = canvasMeasure(stack.ownerDocument)
    for (const page of layout.pages) {
      const host = stack.querySelector<HTMLElement>(
        `.pdf-page[data-page-index="${String(page.index)}"] .pdf-text-host`,
      )
      if (host === null) continue
      host.replaceChildren(buildTextLayer(stack.ownerDocument, page, measure))
    }
    setTextReady(true)
    onRenderedRef.current?.(stack)
  }, [layout, pageCount])

  useReviewSurface({
    hostRef: stackRef,
    ready: textReady,
    detections,
    focusedId,
    onFocusDetection,
    onUnwrappable,
  })

  // ---- keep the focused detection on screen (canvas scroller only) --------
  useEffect(() => {
    if (!textReady || focusedId === null) return
    const scroller = scrollRef.current
    const stack = stackRef.current
    if (scroller === null || stack === null) return
    const detection = detections.find((d) => d.id === focusedId)
    const target =
      findByAttr(stack, 'data-detection-id', focusedId) ??
      (detection !== undefined ? findByAttr(stack, 'data-segment-id', detection.segmentId) : null)
    if (target !== null) scrollWithin(scroller, target, 'nearest')
  }, [focusedId, textReady, detections])

  // ---- canvas rendering: visible pages, re-rendered on zoom ---------------
  useEffect(() => {
    if (load.kind !== 'ready') return undefined
    const scroller = scrollRef.current
    const stack = stackRef.current
    if (scroller === null || stack === null) return undefined
    if (typeof IntersectionObserver === 'undefined') return undefined
    const pdf = load.pdf
    const dpr = window.devicePixelRatio || 1
    const tasks = new Map<number, RenderTask>()
    const done = new Set<number>()
    const life = { disposed: false }
    const isDisposed = (): boolean => life.disposed

    const renderPage = async (index: number): Promise<void> => {
      if (done.has(index) || tasks.has(index)) return
      const canvas = stack.querySelector<HTMLCanvasElement>(
        `.pdf-page[data-page-index="${String(index)}"] canvas`,
      )
      if (canvas === null) return
      const page = await pdf.getPage(index + 1)
      if (isDisposed()) return
      const viewport = page.getViewport({ scale: scale * dpr })
      // Draw offscreen and swap, so zooming never shows a blank page
      // while the new raster is being produced.
      const scratch = stack.ownerDocument.createElement('canvas')
      scratch.width = Math.floor(viewport.width)
      scratch.height = Math.floor(viewport.height)
      const task = page.render({ canvas: scratch, viewport })
      tasks.set(index, task)
      try {
        await task.promise
        if (isDisposed()) return
        canvas.width = scratch.width
        canvas.height = scratch.height
        canvas.getContext('2d')?.drawImage(scratch, 0, 0)
        done.add(index)
      } catch {
        // RenderingCancelledException on zoom/unmount — nothing to do.
      } finally {
        tasks.delete(index)
      }
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const index = Number((entry.target as HTMLElement).dataset.pageIndex)
          void renderPage(index)
        }
      },
      { root: scroller, rootMargin: '600px 0px' },
    )
    for (const el of stack.querySelectorAll('.pdf-page')) io.observe(el)

    return () => {
      life.disposed = true
      io.disconnect()
      for (const t of tasks.values()) t.cancel()
    }
  }, [load, scale])

  // ---- current page (for the page rail) -----------------------------------
  const onScroll = useCallback(() => {
    const scroller = scrollRef.current
    const stack = stackRef.current
    if (scroller === null || stack === null) return
    const top = scroller.getBoundingClientRect().top + scroller.clientHeight / 3
    let current = 0
    for (const el of stack.querySelectorAll<HTMLElement>('.pdf-page')) {
      if (el.getBoundingClientRect().top <= top) current = Number(el.dataset.pageIndex)
    }
    setCurrentPage(current)
  }, [])

  const goToPage = useCallback((index: number) => {
    const scroller = scrollRef.current
    const el = stackRef.current?.querySelector<HTMLElement>(
      `.pdf-page[data-page-index="${String(index)}"]`,
    )
    if (scroller === null || el === null || el === undefined) return
    scrollWithin(scroller, el, 'start')
  }, [])

  const unscanned = layout?.unscanned ?? []

  return (
    <section
      className="canvas pdf-canvas"
      aria-busy={load.kind === 'loading' || layoutState.kind === 'loading'}
      aria-label="PDF document"
    >
      {load.kind === 'loading' ? (
        <p className="canvas-status" role="status">
          <span className="spinner" aria-hidden="true" />
          Rendering pages…
        </p>
      ) : null}
      {load.kind === 'error' ? (
        <p className="canvas-status is-error" role="alert">
          Could not render this PDF: {load.message}
        </p>
      ) : null}
      {load.kind === 'ready' && client === null ? (
        <p className="canvas-status is-error" role="alert">
          PDF review needs the Sanctum engine, which is not running.
        </p>
      ) : null}
      {load.kind === 'ready' && layoutState.kind === 'loading' ? (
        <p className="canvas-status" role="status">
          <span className="spinner" aria-hidden="true" />
          Placing findings on the pages…
        </p>
      ) : null}
      {layoutState.kind === 'error' ? (
        <p className="canvas-status is-error" role="alert">
          Could not read the text of this PDF: {layoutState.message}
        </p>
      ) : null}
      <div className="pptx-split">
        {load.kind === 'ready' ? (
          <PdfPageRail
            pdf={load.pdf}
            sizes={pageSizes}
            current={currentPage}
            layout={layout}
            detections={detections}
            onSelect={goToPage}
          />
        ) : null}
        <div ref={scrollRef} className="canvas-scroll pdf-scroll" onScroll={onScroll}>
          {unscanned.length > 0 ? <UnscannedNotice items={unscanned} noun="PDF" /> : null}
          <div
            ref={stackRef}
            className="pdf-page-stack"
            data-testid="pdf-body"
            style={{ ['--pdf-scale' as string]: String(scale) }}
          >
            {pageSizes.map((size, i) => (
              <div
                key={i}
                className="pdf-page"
                data-page-index={i}
                style={{ width: scaledLength(size.width), height: scaledLength(size.height) }}
              >
                <canvas className="pdf-page-canvas" aria-label={`Page ${String(i + 1)}`} />
                <div className="pdf-text-host" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

interface PdfPageRailProps {
  readonly pdf: PDFDocumentProxy
  readonly sizes: readonly PageSize[]
  readonly current: number
  readonly layout: ReviewSessionLayout | null
  readonly detections: readonly Detection[]
  readonly onSelect: (index: number) => void
}

interface ThumbMark {
  readonly key: string
  readonly top: number
  readonly left: number
  readonly width: number
}

/**
 * Page thumbnails (PDF.js rasters) with the pending findings marked on
 * them. Same look as the pptx slide rail.
 */
function PdfPageRail({
  pdf,
  sizes,
  current,
  layout,
  detections,
  onSelect,
}: PdfPageRailProps): ReactElement {
  const railRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const rail = railRef.current
    if (rail === null) return undefined
    const ctrl = { cancelled: false }
    const isCancelled = (): boolean => ctrl.cancelled
    const tasks: RenderTask[] = []
    void (async () => {
      const dpr = window.devicePixelRatio || 1
      for (let i = 0; i < sizes.length && !isCancelled(); i++) {
        const canvas = rail.querySelector<HTMLCanvasElement>(
          `canvas[data-thumb-index="${String(i)}"]`,
        )
        if (canvas === null) continue
        const page = await pdf.getPage(i + 1)
        if (isCancelled()) return
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (THUMB_WIDTH_PX / base.width) * dpr })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const task = page.render({ canvas, viewport })
        tasks.push(task)
        try {
          await task.promise
        } catch {
          return
        }
      }
    })()
    return () => {
      ctrl.cancelled = true
      for (const t of tasks) t.cancel()
    }
  }, [pdf, sizes.length])

  const counts = useMemo(() => countByPage(headsOf(detections)), [detections])
  // One bar per text line that still has a pending finding. Every
  // thumbnail is THUMB_WIDTH_PX wide whatever its page size, so the
  // mapping uses each line's own page width.
  const marks = useMemo(() => {
    const out = new Map<number, ThumbMark[]>()
    if (layout === null) return out
    const seen = new Set<string>()
    for (const d of detections) {
      if (d.status !== 'pending' || seen.has(d.segmentId)) continue
      seen.add(d.segmentId)
      const page = pageIndexOfSegment(d.segmentId)
      const box = textlineBox(layout, d.segmentId, { pageWidthPx: THUMB_WIDTH_PX })
      if (page === null || box === null) continue
      const list = out.get(page) ?? []
      list.push({ key: d.segmentId, top: box.top, left: box.left, width: box.width })
      out.set(page, list)
    }
    return out
  }, [layout, detections])

  return (
    <nav ref={railRef} className="pptx-rail pdf-rail" aria-label="Pages">
      {sizes.map((size, i) => {
        const c = counts.get(i)
        return (
          <button
            key={i}
            type="button"
            className={`pptx-rail-item${i === current ? ' is-active' : ''}`}
            aria-current={i === current ? 'page' : undefined}
            title={`Go to page ${String(i + 1)}`}
            onClick={() => {
              onSelect(i)
            }}
          >
            <span className="pptx-rail-number">{String(i + 1)}</span>
            <span className="pdf-thumb">
              <canvas
                data-thumb-index={i}
                style={{
                  width: THUMB_WIDTH_PX,
                  height: (THUMB_WIDTH_PX * size.height) / size.width,
                }}
              />
              {(marks.get(i) ?? []).map((m) => (
                <span
                  key={m.key}
                  className="pdf-thumb-mark"
                  style={{ top: m.top, left: m.left, width: Math.max(m.width, 3) }}
                />
              ))}
            </span>
            {c !== undefined ? (
              <span
                className={`pptx-rail-badge${c.pending > 0 ? ' is-pending' : ''}`}
                title={`${String(c.pending)} to review of ${String(c.total)}`}
              >
                {c.pending > 0 ? String(c.pending) : <Icon name="check" size={10} />}
              </span>
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}

function findByAttr(root: HTMLElement, attr: string, value: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
    if (el.getAttribute(attr) === value) return el
  }
  return null
}
