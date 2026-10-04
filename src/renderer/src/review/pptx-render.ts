/**
 * Render a `/layout` payload (the engine's shared layout contract) as plain
 * DOM: one `.pptx-slide` per page with absolutely positioned items.
 *
 * Built imperatively into a host element — the same model as
 * docx-preview — because the review machinery (`wrapDetections`,
 * EditReplacement) mutates the rendered DOM afterwards, which React
 * must not own.
 *
 * Invariant the rest of the review surface depends on: every run is one
 * element carrying `data-segment-id`, whose `textContent` equals the
 * segment text, with no other text inside it. Nothing else in the host
 * carries `data-segment-id` (thumbnails strip it — see `cloneForThumbnail`).
 *
 * Scaling: positions are percentages of the slide box, and font sizes
 * are container-query units (`cqw`) of the slide, so a slide scales to
 * any width with no JS. Overflowing text boxes are shrunk afterwards by
 * `fitTextboxes` through a per-box `--pptx-fit` factor, which is
 * scale-invariant for the same reason.
 */

import type {
  LayoutImageItem,
  LayoutPage,
  LayoutParagraph,
  LayoutShapeItem,
  LayoutTextboxItem,
  LayoutTextlineItem,
  ReviewSessionLayout,
} from '../api/types'
import type { Detection } from './types'

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.%\s,/]+\))$/i

/** Engine colours are `#rrggbb`; anything else (e.g. `url(...)`) is dropped. */
export function safeColor(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const v = value.trim()
  return SAFE_COLOR.test(v) ? v : null
}

/** Image sources must be inline raster data (`data:image/...`), never SVG. */
export function isSafeImageSrc(src: string): boolean {
  return /^data:image\/(png|jpe?g|gif|bmp|webp|x-icon|vnd\.microsoft\.icon);/i.test(src)
}

/** Default PowerPoint text-frame insets, in points (0.1in L/R, 0.05in T/B). */
const INSET_X_PT = 7.2
const INSET_Y_PT = 3.6
const MIN_FIT = 0.35
/** Size for empty paragraphs, which carry no run sizes. */
const DEFAULT_PARA_PT = 18

export function renderPptxLayout(host: HTMLElement, layout: ReviewSessionLayout): void {
  const doc = host.ownerDocument
  const deck = doc.createElement('div')
  deck.className = 'pptx-deck'
  for (const page of layout.pages) {
    deck.appendChild(renderPage(doc, page))
  }
  host.replaceChildren(deck)
}

function renderPage(doc: Document, page: LayoutPage): HTMLElement {
  const frame = doc.createElement('section')
  frame.className = 'pptx-slide-frame'
  frame.dataset.slideIndex = String(page.index)
  frame.setAttribute('aria-label', `Slide ${String(page.index + 1)}`)

  const label = doc.createElement('div')
  label.className = 'pptx-slide-label'
  label.textContent = `Slide ${String(page.index + 1)}`
  frame.appendChild(label)

  const slide = doc.createElement('div')
  slide.className = 'pptx-slide'
  slide.style.aspectRatio = `${String(page.width)} / ${String(page.height)}`
  const ctx: PageCtx = { doc, w: page.width, h: page.height }

  const altTexts: { segmentId: string; text: string }[] = []
  for (const item of page.items) {
    switch (item.kind) {
      case 'shape':
        slide.appendChild(renderShape(ctx, item))
        break
      case 'image':
        slide.appendChild(renderImage(ctx, item))
        if (item.alt !== undefined && item.alt !== null) {
          altTexts.push({ segmentId: item.alt.segment_id, text: item.alt.text })
        }
        break
      case 'textbox':
        slide.appendChild(renderTextbox(ctx, item))
        break
      case 'textline':
        slide.appendChild(renderTextline(ctx, item))
        break
    }
  }
  frame.appendChild(slide)

  const notes = page.notes ?? []
  if (notes.length > 0 || altTexts.length > 0) {
    frame.appendChild(renderOffSlide(doc, notes, altTexts))
  }
  return frame
}

interface PageCtx {
  readonly doc: Document
  readonly w: number
  readonly h: number
}

function pct(value: number, total: number): string {
  return `${String(total > 0 ? (value / total) * 100 : 0)}%`
}

/** Points on the slide → container-query width units of the slide. */
function cqw(pt: number, pageWidth: number): string {
  return `${String(pageWidth > 0 ? (pt / pageWidth) * 100 : 0)}cqw`
}

function place(
  el: HTMLElement,
  ctx: PageCtx,
  box: LayoutShapeItem | LayoutTextboxItem | LayoutImageItem | LayoutTextlineItem,
): void {
  el.style.left = pct(box.x, ctx.w)
  el.style.top = pct(box.y, ctx.h)
  el.style.width = pct(box.w, ctx.w)
  el.style.height = pct(box.h, ctx.h)
}

function renderShape(ctx: PageCtx, item: LayoutShapeItem): HTMLElement {
  const el = ctx.doc.createElement('div')
  el.className = 'pptx-shape'
  place(el, ctx, item)
  const fill = safeColor(item.fill)
  if (fill !== null) el.style.backgroundColor = fill
  return el
}

function renderImage(ctx: PageCtx, item: LayoutImageItem): HTMLElement {
  // Only inline raster data is drawn: anything else (a URL, file path,
  // SVG/script data) renders the placeholder, like an unpreviewable format.
  if (item.src === null || !isSafeImageSrc(item.src)) {
    const el = ctx.doc.createElement('div')
    el.className = 'pptx-image pptx-image-missing'
    el.title = 'This image format cannot be previewed'
    place(el, ctx, item)
    return el
  }
  const img = ctx.doc.createElement('img')
  img.className = 'pptx-image'
  img.src = item.src
  // Alt-text is reviewed as its own segment under the slide; keep the
  // attribute empty so the same PII is not duplicated for screen readers.
  img.alt = ''
  img.draggable = false
  place(img, ctx, item)
  return img
}

function renderTextbox(ctx: PageCtx, item: LayoutTextboxItem): HTMLElement {
  const el = ctx.doc.createElement('div')
  el.className = `pptx-textbox pptx-anchor-${item.anchor ?? 'top'}`
  place(el, ctx, item)
  el.style.padding = `${cqw(INSET_Y_PT, ctx.w)} ${cqw(INSET_X_PT, ctx.w)}`
  for (const para of item.paragraphs) {
    el.appendChild(renderParagraph(ctx.doc, para, (size) => cqw(size, ctx.w)))
  }
  return el
}

function renderTextline(ctx: PageCtx, item: LayoutTextlineItem): HTMLElement {
  const el = ctx.doc.createElement('span')
  el.className = 'pptx-textline'
  place(el, ctx, item)
  el.style.fontSize = `calc(${cqw(item.size, ctx.w)} * var(--pptx-fit, 1))`
  el.setAttribute('data-segment-id', item.segment_id)
  el.textContent = item.text
  return el
}

function renderParagraph(
  doc: Document,
  para: LayoutParagraph,
  sizeToCss: ((size: number) => string) | null,
): HTMLElement {
  const p = doc.createElement('p')
  p.className = 'pptx-p'
  p.style.textAlign = para.align ?? 'left'
  if (sizeToCss !== null) {
    // Size the paragraph itself too: its line box (strut) otherwise uses
    // the page's 16px font, which dwarfs small slide text in thumbnails
    // and makes the overflow fit shrink text that actually fits.
    const size = para.runs.reduce((m, r) => Math.max(m, r.size), 0) || DEFAULT_PARA_PT
    p.style.fontSize = `calc(${sizeToCss(size)} * var(--pptx-fit, 1))`
  }
  for (const run of para.runs) {
    const span = doc.createElement('span')
    span.className = 'pptx-run'
    span.setAttribute('data-segment-id', run.segment_id)
    span.textContent = run.text
    if (sizeToCss !== null) {
      span.style.fontSize = `calc(${sizeToCss(run.size)} * var(--pptx-fit, 1))`
    }
    if (run.bold === true) span.style.fontWeight = '700'
    if (run.italic === true) span.style.fontStyle = 'italic'
    const color = safeColor(run.color)
    if (color !== null) span.style.color = color
    if (run.font !== undefined && run.font !== null && run.font !== '') {
      span.style.fontFamily = `${JSON.stringify(run.font)}, var(--pptx-font)`
    }
    p.appendChild(span)
  }
  return p
}

function renderOffSlide(
  doc: Document,
  notes: readonly LayoutParagraph[],
  altTexts: readonly { segmentId: string; text: string }[],
): HTMLElement {
  const box = doc.createElement('div')
  box.className = 'pptx-offslide'
  // Alt-text before notes: the engine's segment order (shapes, then notes).
  if (altTexts.length > 0) {
    const section = doc.createElement('div')
    section.className = 'pptx-alts'
    const heading = doc.createElement('div')
    heading.className = 'pptx-offslide-heading'
    heading.textContent = 'Picture alt text'
    section.appendChild(heading)
    for (const alt of altTexts) {
      const p = doc.createElement('p')
      p.className = 'pptx-p'
      const span = doc.createElement('span')
      span.className = 'pptx-run'
      span.setAttribute('data-segment-id', alt.segmentId)
      span.textContent = alt.text
      p.appendChild(span)
      section.appendChild(p)
    }
    box.appendChild(section)
  }
  if (notes.length > 0) {
    const section = doc.createElement('div')
    section.className = 'pptx-notes'
    const heading = doc.createElement('div')
    heading.className = 'pptx-offslide-heading'
    heading.textContent = 'Speaker notes'
    section.appendChild(heading)
    for (const para of notes) section.appendChild(renderParagraph(doc, para, null))
    box.appendChild(section)
  }
  return box
}

/**
 * Shrink each overflowing text box (PowerPoint "shrink text on overflow"
 * is usually computed by PowerPoint at open time and not stored, so the
 * layout's sizes are often too big for the box). Needs real layout —
 * a no-op under happy-dom where every size is 0.
 */
export function fitTextboxes(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('.pptx-textbox')) {
    let fit = 1
    box.style.removeProperty('--pptx-fit')
    while (box.scrollHeight > box.clientHeight + 1 && fit > MIN_FIT) {
      fit *= 0.9
      box.style.setProperty('--pptx-fit', fit.toFixed(3))
    }
  }
}

/**
 * Deep-clone a rendered slide for the thumbnail rail with every
 * `data-segment-id` / review wrapper stripped, so segment lookups over
 * the document never see duplicates.
 */
export function cloneForThumbnail(slide: HTMLElement): HTMLElement {
  const clone = slide.cloneNode(true) as HTMLElement
  for (const el of clone.querySelectorAll('[data-segment-id]')) {
    el.removeAttribute('data-segment-id')
  }
  for (const el of clone.querySelectorAll('[data-detection-id]')) {
    el.removeAttribute('data-detection-id')
    el.classList.remove('sanctum-edit')
  }
  clone.setAttribute('aria-hidden', 'true')
  return clone
}

/** 0-based slide index encoded in a pptx segment id (`slide3/...`), or null. */
export function slideIndexOfSegment(segmentId: string): number | null {
  const m = /^slide(\d+)\//.exec(segmentId)
  return m?.[1] !== undefined ? Number(m[1]) : null
}

export interface SlideGroup {
  /** 0-based slide index, or -1 for detections not tied to a slide. */
  readonly slide: number
  readonly detections: Detection[]
}

/**
 * Group detections by the slide their segment sits on (shapes, alt text
 * and speaker notes of a slide share one group), slides in ascending
 * order, document order kept inside each group. Ids without a `slide{i}/`
 * prefix go in a trailing `slide: -1` group.
 */
export function groupDetectionsBySlide(detections: readonly Detection[]): SlideGroup[] {
  const bySlide = new Map<number, Detection[]>()
  for (const d of detections) {
    const slide = slideIndexOfSegment(d.segmentId) ?? -1
    const list = bySlide.get(slide)
    if (list === undefined) bySlide.set(slide, [d])
    else list.push(d)
  }
  return [...bySlide.entries()]
    .sort(([a], [b]) => (a === -1 ? 1 : b === -1 ? -1 : a - b))
    .map(([slide, list]) => ({ slide, detections: list }))
}
