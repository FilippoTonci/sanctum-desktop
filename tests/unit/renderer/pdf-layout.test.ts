// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { LayoutPage, LayoutTextlineItem } from '../../../src/renderer/src/api/types'
import { isPdfFile, rejectReason } from '../../../src/renderer/src/components/DropZone'
import { detectionIdFromClick } from '../../../src/renderer/src/review/click-focus'
import { wrapDetections } from '../../../src/renderer/src/review/edit-wrap'
import { resolveDetections } from '../../../src/renderer/src/review/highlights'
import {
  buildTextLayer,
  countByPage,
  CSS_PX_PER_POINT,
  cssFontForPdfFont,
  fontShorthand,
  horizontalScale,
  pageIndexOfSegment,
  pointsToPx,
  scaledLength,
  scaleForZoom,
  textlineBox,
  textlineScaleX,
  widestPage,
  type MeasureText,
} from '../../../src/renderer/src/review/pdf-layout'
import {
  extractSegmentOrder,
  findSegmentRange,
  sliceSegmentText,
} from '../../../src/renderer/src/review/segments'
import type { Detection } from '../../../src/renderer/src/review/types'

function line(over: Partial<LayoutTextlineItem> = {}): LayoutTextlineItem {
  return {
    kind: 'textline',
    x: 72,
    y: 100,
    w: 200,
    h: 10,
    segment_id: 'page0/line0',
    text: 'Contact Jane Roe today',
    size: 10,
    ...over,
  }
}

function page(items: LayoutTextlineItem[], over: Partial<LayoutPage> = {}): LayoutPage {
  return { index: 0, width: 612, height: 792, items, ...over }
}

/** Fake measure: every character is 0.5em wide in any font. */
const halfEm: MeasureText = (text, font) => {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '0')
  return text.length * px * 0.5
}

describe('point → pixel mapping', () => {
  it('100% is 96/72 CSS px per point; 150% is 1.5× that', () => {
    expect(CSS_PX_PER_POINT).toBeCloseTo(1.3333, 4)
    expect(scaleForZoom('100', 999, 612)).toBeCloseTo(4 / 3)
    expect(scaleForZoom('150', 999, 612)).toBeCloseTo(2)
  })

  it('fit width maps the widest page onto the available width', () => {
    expect(scaleForZoom('fit', 918, 612)).toBeCloseTo(1.5)
    expect(pointsToPx(612, scaleForZoom('fit', 918, 612))).toBeCloseTo(918)
  })

  it('fit width falls back to 100% before anything is measured', () => {
    expect(scaleForZoom('fit', 0, 612)).toBeCloseTo(CSS_PX_PER_POINT)
    expect(scaleForZoom('fit', 800, 0)).toBeCloseTo(CSS_PX_PER_POINT)
  })

  it('writes lengths against --pdf-scale so zoom never rebuilds the layer', () => {
    expect(scaledLength(72)).toBe('calc(var(--pdf-scale) * 72px)')
    expect(scaledLength(10.123456)).toBe('calc(var(--pdf-scale) * 10.1235px)')
  })

  it('maps points to pixels per page when page sizes differ', () => {
    const layout = {
      format: 'pdf' as const,
      pages: [
        {
          index: 0,
          width: 595.28,
          height: 841.89,
          items: [line({ segment_id: 'page0/line0', x: 72, y: 72, w: 100, h: 12 })],
        },
        {
          index: 1,
          width: 612,
          height: 792,
          items: [line({ segment_id: 'page1/line0', x: 72, y: 72, w: 100, h: 12 })],
        },
      ],
      unscanned: [],
    }
    const a = textlineBox(layout, 'page0/line0', { pageWidthPx: 1000 })
    const b = textlineBox(layout, 'page1/line0', { pageWidthPx: 1000 })
    expect(a?.left).toBeCloseTo((72 / 595.28) * 1000)
    expect(b?.left).toBeCloseTo((72 / 612) * 1000)
  })

  it('widestPage picks the widest page box', () => {
    expect(widestPage({ pages: [page([]), page([], { index: 1, width: 842 })] })).toBe(842)
  })
})

describe('font mapping and horizontal fit', () => {
  it('maps PDF base font names to metric-compatible CSS families', () => {
    expect(cssFontForPdfFont('Helvetica')).toMatchObject({ weight: 'normal', style: 'normal' })
    expect(cssFontForPdfFont('Helvetica').family).toContain('Helvetica')
    expect(cssFontForPdfFont('Times-BoldItalic')).toMatchObject({ weight: 'bold', style: 'italic' })
    expect(cssFontForPdfFont('Times-Roman').family).toContain('Times')
    expect(cssFontForPdfFont('ABCDEF+Courier-Oblique').family).toContain('Courier')
    expect(cssFontForPdfFont('AAAAAA+BitstreamVeraSans-Bold').family).toContain('Helvetica')
    expect(cssFontForPdfFont(undefined).family).toContain('sans-serif')
  })

  it('builds a canvas font shorthand', () => {
    expect(fontShorthand(cssFontForPdfFont('Helvetica-Bold'), 100)).toMatch(/^normal bold 100px /)
  })

  it('squeezes a line to the PDF width, and degrades to 1 without measurement', () => {
    expect(horizontalScale(90, 100)).toBeCloseTo(0.9)
    expect(horizontalScale(90, 0)).toBe(1)
    expect(horizontalScale(0, 50)).toBe(1)
    // 22 chars × 0.5em × 10pt = 110pt natural; PDF says 200pt wide.
    expect(textlineScaleX(line(), halfEm)).toBeCloseTo(200 / 110)
  })
})

describe('buildTextLayer', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('emits one [data-segment-id] per textline whose textContent is the segment text', () => {
    const layer = buildTextLayer(
      document,
      page([line(), line({ segment_id: 'page0/line1', text: 'Second line', y: 120 })]),
      halfEm,
    )
    const els = [...layer.querySelectorAll<HTMLElement>('[data-segment-id]')]
    expect(els.map((e) => e.getAttribute('data-segment-id'))).toEqual([
      'page0/line0',
      'page0/line1',
    ])
    expect(els.map((e) => e.textContent)).toEqual(['Contact Jane Roe today', 'Second line'])
    // Exactly one text node: segment offsets are counted against it.
    expect(els[0]?.childNodes).toHaveLength(1)
  })

  it('carries line geometry in points for the --pdf-scale CSS rule', () => {
    const layer = buildTextLayer(document, page([line({ font: 'Times-Bold' })]), halfEm)
    const el = layer.querySelector<HTMLElement>('.pdf-textline')
    expect(el?.style.getPropertyValue('--x')).toBe('72')
    expect(el?.style.getPropertyValue('--y')).toBe('100')
    expect(el?.style.getPropertyValue('--h')).toBe('10')
    expect(el?.style.getPropertyValue('--size')).toBe('10')
    expect(el?.style.fontWeight).toBe('bold')
    expect(el?.style.transform).toMatch(/^scaleX\(1\.818/)
  })

  it('omits the transform when measurement is unavailable', () => {
    const layer = buildTextLayer(document, page([line()]), () => 0)
    expect(layer.querySelector<HTMLElement>('.pdf-textline')?.style.transform).toBe('')
  })

  it('ignores non-textline items', () => {
    const p: LayoutPage = {
      ...page([line()]),
      items: [{ kind: 'image', x: 0, y: 0, w: 10, h: 10, src: null }, line()],
    }
    expect(buildTextLayer(document, p, halfEm).children).toHaveLength(1)
  })
})

describe('review machinery on the PDF text layer (view wiring)', () => {
  const det = (over: Partial<Detection>): Detection => ({
    id: 'd1',
    segmentId: 'page0/line0',
    start: 8,
    end: 16,
    text: 'Jane Roe',
    entityType: 'PERSON',
    status: 'pending',
    ...over,
  })

  function mount(): HTMLElement {
    const stack = document.createElement('div')
    stack.appendChild(
      buildTextLayer(
        document,
        page([line(), line({ segment_id: 'page0/line1', text: 'Call 555 0100', y: 120 })]),
        halfEm,
      ),
    )
    const p1 = buildTextLayer(
      document,
      page([line({ segment_id: 'page1/line0', text: 'Page two Jane Roe' })], { index: 1 }),
      halfEm,
    )
    stack.appendChild(p1)
    document.body.replaceChildren(stack)
    return stack
  }

  it('segments.ts resolves (segmentId, start, end) inside a textline', () => {
    const stack = mount()
    expect(extractSegmentOrder(stack)).toEqual(['page0/line0', 'page0/line1', 'page1/line0'])
    const range = findSegmentRange(stack, { segmentId: 'page0/line0', start: 8, end: 16 })
    expect(range?.toString()).toBe('Jane Roe')
  })

  it('edit-wrap wraps detections, keeps segment offsets, and click-to-focus resolves them', () => {
    const stack = mount()
    const detections = [
      det({}),
      det({ id: 'd2', segmentId: 'page0/line1', start: 5, end: 13, text: '555 0100' }),
      det({ id: 'd3', segmentId: 'page1/line0', start: 9, end: 17 }),
    ]
    expect(wrapDetections(stack, detections)).toEqual([])
    expect(resolveDetections(stack, detections)).toHaveLength(3)
    const wrap = stack.querySelector('.sanctum-edit[data-detection-id="d3"]')
    expect(wrap?.textContent).toBe('Jane Roe')
    expect(detectionIdFromClick(wrap?.firstChild ?? null, true)).toBe('d3')
    // Offsets still count against the untouched segment text after wrapping.
    expect(sliceSegmentText(stack, { segmentId: 'page0/line0', start: 0, end: 7 })).toBe('Contact')
  })

  it('countByPage groups detections by the page prefix of their segment id', () => {
    const counts = countByPage([
      { segmentId: 'page0/line1', status: 'pending' },
      { segmentId: 'page0/line7', status: 'accepted' },
      { segmentId: 'page2/line0', status: 'rejected' },
      { segmentId: 'body/p0/r0', status: 'pending' },
    ])
    expect([...counts]).toEqual([
      [0, { total: 2, pending: 1 }],
      [2, { total: 1, pending: 0 }],
    ])
    expect(pageIndexOfSegment('page12/line3')).toBe(12)
    expect(pageIndexOfSegment('slide1/sp2')).toBeNull()
  })
})

describe('DropZone format gate', () => {
  const file = (name: string, type = ''): File => new File(['x'], name, { type })

  it('accepts .docx, .pptx and .pdf by extension or mimetype', () => {
    expect(rejectReason(file('a.DOCX'))).toBeNull()
    expect(rejectReason(file('a.pptx'))).toBeNull()
    expect(rejectReason(file('a.PDF'))).toBeNull()
    expect(rejectReason(file('blob', 'application/pdf'))).toBeNull()
    expect(rejectReason(file('a.xlsx'))).toMatch(/PDF/)
  })

  it('isPdfFile picks the PDF view by extension or mimetype', () => {
    expect(isPdfFile({ name: 'a.pdf', type: '' })).toBe(true)
    expect(isPdfFile({ name: 'blob', type: 'application/pdf' })).toBe(true)
    expect(isPdfFile({ name: 'a.docx', type: '' })).toBe(false)
    expect(isPdfFile({ name: 'a.pdf.pptx', type: '' })).toBe(false)
  })
})
