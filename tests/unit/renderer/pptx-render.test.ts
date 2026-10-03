// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { ReviewSessionLayout } from '../../../src/renderer/src/api/types'
import { rejectReason } from '../../../src/renderer/src/components/DropZone'
import {
  cloneForThumbnail,
  isSafeImageSrc,
  renderPptxLayout,
  safeColor,
  slideIndexOfSegment,
} from '../../../src/renderer/src/review/pptx-render'
import { extractSegmentOrder, findSegmentRange } from '../../../src/renderer/src/review/segments'

const LAYOUT: ReviewSessionLayout = {
  format: 'pptx',
  pages: [
    {
      index: 0,
      width: 720,
      height: 540,
      items: [
        { kind: 'shape', x: 0, y: 0, w: 720, h: 540, fill: '#FAF6EE' },
        {
          kind: 'textbox',
          x: 36,
          y: 54,
          w: 360,
          h: 90,
          anchor: 'middle',
          paragraphs: [
            {
              align: 'center',
              runs: [
                { segment_id: 'slide0/shape0/p0/r0', text: 'Prepared for ', size: 20 },
                {
                  segment_id: 'slide0/shape0/p0/r1',
                  text: 'Margaret Holloway',
                  size: 20,
                  bold: true,
                  color: '#112233',
                },
              ],
            },
            { align: 'left', runs: [] },
          ],
        },
        {
          kind: 'image',
          x: 400,
          y: 100,
          w: 200,
          h: 150,
          src: 'data:image/png;base64,AAAA',
          alt: { segment_id: 'slide0/shape1/alt', text: 'Photo of Samuel Achterberg' },
        },
        { kind: 'image', x: 0, y: 0, w: 10, h: 10, src: null, alt: null },
      ],
      notes: [{ runs: [{ segment_id: 'slide0/notes/p0/r0', text: 'Call Daniel.', size: 12 }] }],
    },
    { index: 1, width: 720, height: 540, items: [], notes: null },
  ],
  unscanned: [],
}

function render(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  renderPptxLayout(host, LAYOUT)
  return host
}

describe('renderPptxLayout', () => {
  it('renders one element per segment whose textContent is the segment text', () => {
    const host = render()
    expect(extractSegmentOrder(host)).toEqual([
      'slide0/shape0/p0/r0',
      'slide0/shape0/p0/r1',
      'slide0/shape1/alt',
      'slide0/notes/p0/r0',
    ])
    const byId = new Map(
      [...host.querySelectorAll('[data-segment-id]')].map((el) => [
        el.getAttribute('data-segment-id'),
        el.textContent,
      ]),
    )
    expect(byId.get('slide0/shape0/p0/r1')).toBe('Margaret Holloway')
    expect(byId.get('slide0/shape1/alt')).toBe('Photo of Samuel Achterberg')
    expect(byId.get('slide0/notes/p0/r0')).toBe('Call Daniel.')
  })

  it('positions items as percentages of the slide and keeps run styling', () => {
    const host = render()
    expect(host.querySelectorAll('.pptx-slide')).toHaveLength(2)
    const box = host.querySelector<HTMLElement>('.pptx-textbox')
    expect(box?.style.left).toBe('5%')
    expect(box?.style.width).toBe('50%')
    expect(box?.classList.contains('pptx-anchor-middle')).toBe(true)
    const bold = host.querySelector<HTMLElement>('[data-segment-id="slide0/shape0/p0/r1"]')
    expect(bold?.style.fontWeight).toBe('700')
    expect(host.querySelector('.pptx-image-missing')).not.toBeNull()
    expect(host.querySelector<HTMLImageElement>('img.pptx-image')?.alt).toBe('')
  })

  it('lets the existing segment locator resolve ranges inside runs', () => {
    const host = render()
    const range = findSegmentRange(host, {
      segmentId: 'slide0/shape0/p0/r1',
      start: 9,
      end: 17,
    })
    expect(range?.toString()).toBe('Holloway')
  })

  it('strips segment ids from thumbnail clones', () => {
    const host = render()
    const slide = host.querySelector<HTMLElement>('.pptx-slide')
    if (slide === null) throw new Error('no slide')
    const clone = cloneForThumbnail(slide)
    expect(clone.querySelectorAll('[data-segment-id]')).toHaveLength(0)
    expect(clone.textContent).toContain('Margaret Holloway')
    expect(host.querySelectorAll('[data-segment-id]')).toHaveLength(4)
  })
})

describe('pptx helpers', () => {
  it('parses the slide index from segment ids', () => {
    expect(slideIndexOfSegment('slide12/shape0/group1/p0/r0')).toBe(12)
    expect(slideIndexOfSegment('body/p0/r0')).toBeNull()
  })

  it('accepts .docx and .pptx only', () => {
    const file = (name: string, type = ''): File => new File(['x'], name, { type })
    expect(rejectReason(file('Deck.PPTX'))).toBeNull()
    expect(rejectReason(file('memo.docx'))).toBeNull()
    expect(rejectReason(file('scan.pdf', 'application/pdf'))).not.toBeNull()
  })
})

describe('engine-supplied values are sanitised', () => {
  const page = (items: ReviewSessionLayout['pages'][number]['items']): ReviewSessionLayout => ({
    format: 'pptx',
    pages: [{ index: 0, width: 720, height: 540, items, notes: null }],
  })

  it('renders a placeholder for any image src that is not data:image/', () => {
    for (const src of [
      'https://example.com/x.png',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html;base64,AAAA',
      'data:image/svg+xml;base64,AAAA',
    ]) {
      const host = document.createElement('div')
      renderPptxLayout(host, page([{ kind: 'image', x: 0, y: 0, w: 1, h: 1, src, alt: null }]))
      expect(host.querySelector('img')).toBeNull()
      expect(host.querySelector('.pptx-image-missing')).not.toBeNull()
    }
    expect(isSafeImageSrc('data:image/png;base64,AAAA')).toBe(true)
    expect(isSafeImageSrc('data:image/jpeg;base64,AAAA')).toBe(true)
  })

  it('drops fills and run colours that are not hex or rgb(a)', () => {
    expect(safeColor('#1F4E79')).toBe('#1F4E79')
    expect(safeColor('rgba(0, 0, 0, 0.5)')).toBe('rgba(0, 0, 0, 0.5)')
    expect(safeColor('url(https://example.com/x.png)')).toBeNull()
    expect(safeColor('red; background: url(x)')).toBeNull()
    const host = document.createElement('div')
    renderPptxLayout(
      host,
      page([
        { kind: 'shape', x: 0, y: 0, w: 1, h: 1, fill: 'url(https://example.com/x.png)' },
        {
          kind: 'textbox',
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          paragraphs: [
            { runs: [{ segment_id: 's', text: 't', size: 10, color: 'url(https://x/y)' }] },
          ],
        },
      ]),
    )
    expect(host.querySelector<HTMLElement>('.pptx-shape')?.getAttribute('style')).not.toMatch(/url/)
    expect(host.querySelector<HTMLElement>('.pptx-run')?.style.color).toBe('')
  })
})
