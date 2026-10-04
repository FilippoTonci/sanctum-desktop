/**
 * Point → CSS-pixel geometry and the positioned text layer for PDF review.
 *
 * The engine's `/layout` endpoint describes each PDF page as `textline`
 * items in points, top-left origin. PdfView paints the page raster with
 * PDF.js and lays one transparent element per textline over it. Each
 * element carries `data-segment-id` and holds the segment text as a
 * single text node, so the review machinery in `segments.ts`,
 * `highlights.ts` and `edit-wrap.ts` works on it unchanged.
 *
 * Zoom never rebuilds the layer. Each line carries its geometry in
 * points as custom properties (`--x --y --h --size`); the `.pdf-textline`
 * rule in index.css turns them into `calc(var(--pdf-scale) * var(--x) *
 * 1px)` etc., and PdfView changes only `--pdf-scale` (CSS px per point)
 * on the page stack.
 * That keeps element identity, and with it every `.sanctum-edit` wrap,
 * stable across zoom changes.
 *
 * Horizontal fit: the browser draws the text in a stand-in font whose
 * advance widths differ from the embedded PDF font. Each line is
 * measured once at its nominal size and squeezed or stretched with
 * `scaleX` so its width equals the PDF line width. The ratio does not
 * depend on zoom, because both widths scale linearly with font size.
 */

import type { LayoutPage, LayoutTextlineItem, ReviewSessionLayout } from '../api/types'
import type { Detection } from './types'

/** CSS px per point at "100%": PDF.js and every PDF viewer use 96/72. */
export const CSS_PX_PER_POINT = 96 / 72

export type ZoomMode = 'fit' | '100' | '150'

export const ZOOM_MODES: readonly ZoomMode[] = ['fit', '100', '150']

/** Scale (CSS px per point) for a zoom mode. */
export function scaleForZoom(
  mode: ZoomMode,
  availableWidthPx: number,
  widestPagePt: number,
): number {
  switch (mode) {
    case '100':
      return CSS_PX_PER_POINT
    case '150':
      return CSS_PX_PER_POINT * 1.5
    case 'fit':
      if (availableWidthPx <= 0 || widestPagePt <= 0) return CSS_PX_PER_POINT
      return availableWidthPx / widestPagePt
  }
}

/** A length in points, expressed against the `--pdf-scale` custom property. */
export function scaledLength(points: number): string {
  return `calc(var(--pdf-scale) * ${formatNumber(points)}px)`
}

/** Convert a length in points to CSS px at a concrete scale. */
export function pointsToPx(points: number, scale: number): number {
  return points * scale
}

export interface CssFont {
  readonly family: string
  readonly weight: 'normal' | 'bold'
  readonly style: 'normal' | 'italic'
}

const SANS = 'Helvetica, Arial, "Liberation Sans", sans-serif'
const SERIF = '"Times New Roman", Times, "Liberation Serif", serif'
const MONO = '"Courier New", Courier, "Liberation Mono", monospace'

/**
 * Pick a metric-compatible CSS font for a PDF base font name. Subset
 * prefixes (`ABCDEF+Arial-BoldMT`) are ignored. Unknown names fall back
 * to the sans stack; the per-line `scaleX` absorbs the rest.
 */
export function cssFontForPdfFont(pdfFont: string | null | undefined): CssFont {
  const name = (pdfFont ?? '').replace(/^[A-Z]{6}\+/, '').toLowerCase()
  const family = /courier|mono|consol/.test(name)
    ? MONO
    : /times|serif|roman|georgia|garamond|minion|cambria/.test(name) && !name.includes('sans')
      ? SERIF
      : SANS
  const weight = /bold|black|heavy|semibold|demi/.test(name) ? 'bold' : 'normal'
  const style = /italic|oblique/.test(name) ? 'italic' : 'normal'
  return { family, weight, style }
}

/** CSS `font` shorthand, used for canvas measurement. */
export function fontShorthand(font: CssFont, sizePx: number): string {
  return `${font.style} ${font.weight} ${formatNumber(sizePx)}px ${font.family}`
}

/** Measures `text` in the given CSS font shorthand; returns width in px. */
export type MeasureText = (text: string, font: string) => number

/**
 * Horizontal squeeze that makes a line drawn in the stand-in font as
 * wide as the PDF says it is. Returns 1 when measurement is unavailable
 * (happy-dom, zero-width text) so the layer degrades to unscaled text.
 */
export function horizontalScale(targetWidthPt: number, measuredWidthPt: number): number {
  if (!(measuredWidthPt > 0) || !(targetWidthPt > 0)) return 1
  return targetWidthPt / measuredWidthPt
}

/** Measurement is done at this size and scaled, for sub-pixel precision. */
const MEASURE_SIZE = 100

export function textlineScaleX(item: LayoutTextlineItem, measure: MeasureText): number {
  const font = cssFontForPdfFont(item.font)
  const at100 = measure(item.text, fontShorthand(font, MEASURE_SIZE))
  return horizontalScale(item.w, (at100 * item.size) / MEASURE_SIZE)
}

export function textlinesOf(page: LayoutPage): LayoutTextlineItem[] {
  return page.items.filter((it): it is LayoutTextlineItem => it.kind === 'textline')
}

export const TEXTLINE_CLASS = 'pdf-textline'
export const TEXT_LAYER_CLASS = 'pdf-text-layer'

/**
 * Build the transparent text layer for one page. The returned element
 * is sized in points (via `--pdf-scale`) and meant to sit exactly over
 * the page's canvas.
 */
export function buildTextLayer(
  doc: Document,
  page: LayoutPage,
  measure: MeasureText,
): HTMLDivElement {
  const layer = doc.createElement('div')
  layer.className = TEXT_LAYER_CLASS
  layer.dataset.pageIndex = String(page.index)
  // Size comes from CSS (`inset: 0` inside the page box, which PdfView
  // sizes from the same page width/height).

  for (const item of textlinesOf(page)) {
    const el = doc.createElement('span')
    el.className = TEXTLINE_CLASS
    el.setAttribute('data-segment-id', item.segment_id)
    // One text node, exactly the segment text: segments.ts offsets are
    // measured against textContent, so nothing else may live in here.
    el.textContent = item.text
    const font = cssFontForPdfFont(item.font)
    // Raw point values; `.pdf-textline` in index.css multiplies each by
    // --pdf-scale.
    el.style.setProperty('--x', formatNumber(item.x))
    el.style.setProperty('--y', formatNumber(item.y))
    el.style.setProperty('--h', formatNumber(item.h))
    el.style.setProperty('--size', formatNumber(item.size))
    el.style.fontFamily = font.family
    el.style.fontWeight = font.weight
    el.style.fontStyle = font.style
    const sx = textlineScaleX(item, measure)
    if (sx !== 1) el.style.transform = `scaleX(${formatNumber(sx)})`
    layer.appendChild(el)
  }
  return layer
}

/** Widest page in points; `fit` zoom fits this width to the viewport. */
export function widestPage(layout: Pick<ReviewSessionLayout, 'pages'>): number {
  let widest = 0
  for (const p of layout.pages) widest = Math.max(widest, p.width)
  return widest
}

export interface PxBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * Box of one textline in CSS px when its page is drawn `pageWidthPx`
 * wide. The scale comes from that line's own page, never page 0's, so
 * mixed page sizes (A4 next to Letter) map correctly. Null when no page
 * carries the segment.
 */
export function textlineBox(
  layout: Pick<ReviewSessionLayout, 'pages'>,
  segmentId: string,
  opts: { readonly pageWidthPx: number },
): PxBox | null {
  for (const page of layout.pages) {
    const item = textlinesOf(page).find((it) => it.segment_id === segmentId)
    if (item === undefined) continue
    if (!(page.width > 0)) return null
    const scale = opts.pageWidthPx / page.width
    return {
      left: item.x * scale,
      top: item.y * scale,
      width: item.w * scale,
      height: item.h * scale,
    }
  }
  return null
}

/**
 * Canvas-backed text measurement. Returns a function that yields 0 when
 * no 2D context is available (happy-dom), which `horizontalScale` turns
 * into "no squeeze".
 */
export function canvasMeasure(doc: Document): MeasureText {
  const canvas = doc.createElement('canvas')
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = canvas.getContext('2d')
  } catch {
    ctx = null
  }
  return (text, font) => {
    if (ctx === null) return 0
    ctx.font = font
    return ctx.measureText(text).width
  }
}

/** 0-based page of a `page{i}/line{j}` segment id, or null. */
export function pageIndexOfSegment(segmentId: string): number | null {
  const m = /^page(\d+)(?:\/|$)/.exec(segmentId)
  return m === null ? null : Number(m[1])
}

export interface PageCounts {
  total: number
  pending: number
}

/** Detections per page index (all, and still pending), for the page rail. */
export function countByPage(
  detections: readonly Pick<Detection, 'segmentId' | 'status'>[],
): Map<number, PageCounts> {
  const out = new Map<number, PageCounts>()
  for (const d of detections) {
    const page = pageIndexOfSegment(d.segmentId)
    if (page === null) continue
    const c = out.get(page) ?? { total: 0, pending: 0 }
    c.total += 1
    if (d.status === 'pending') c.pending += 1
    out.set(page, c)
  }
  return out
}

function formatNumber(n: number): string {
  return String(Math.round(n * 10000) / 10000)
}
