// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { resolveDetections } from '../../../src/renderer/src/review/highlights'
import { seedFakeDetections } from '../../../src/renderer/src/review/fake-detections'
import type { Detection } from '../../../src/renderer/src/review/types'

function setBody(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

describe('resolveDetections', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('drops detections whose run is not currently rendered', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Hi Alice.</span></p>')
    const detections: Detection[] = [
      {
        id: 'a',
        segmentId: 'body/p0/r0',
        start: 3,
        end: 8,
        text: 'Alice',
        entityType: 'PERSON',
        status: 'pending',
      },
      {
        id: 'b',
        segmentId: 'body/p99/r0',
        start: 0,
        end: 1,
        text: 'X',
        entityType: 'PERSON',
        status: 'pending',
      },
    ]
    const resolved = resolveDetections(root, detections)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.detection.id).toBe('a')
    expect(resolved[0]?.range.toString()).toBe('Alice')
  })

  it('returns an empty list for an empty detection set', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Hi.</span></p>')
    expect(resolveDetections(root, [])).toEqual([])
  })

  it('returns a range surrounding the .sanctum-edit wrap when one exists', () => {
    // After wrapDetections runs, each detection lives inside a wrap.
    // Highlights must paint via a range over the wrap (not its inner
    // text) so CSS swaps between original and replacement keep working
    // and Range.surroundContents on neighbours doesn't invalidate it.
    const root = setBody(
      '<p><span data-segment-id="body/p0/r0">Hi ' +
        '<span class="sanctum-edit" data-detection-id="a">' +
        '<span class="sanctum-edit-original">Alice</span>' +
        '</span>' +
        '.</span></p>',
    )
    const detections: Detection[] = [
      {
        id: 'a',
        segmentId: 'body/p0/r0',
        start: 3,
        end: 8,
        text: 'Alice',
        entityType: 'PERSON',
        status: 'pending',
      },
    ]
    const resolved = resolveDetections(root, detections)
    expect(resolved).toHaveLength(1)
    const range = resolved[0]!.range
    expect(range.toString()).toBe('Alice')
    expect(range.startContainer.nodeType).toBe(Node.ELEMENT_NODE)
    const wrap = root.querySelector('.sanctum-edit[data-detection-id="a"]')
    expect(range.startContainer).toBe(wrap?.parentNode)
    expect(range.endContainer).toBe(wrap?.parentNode)
    // The range should span exactly the wrap element (one child).
    expect(range.endOffset - range.startOffset).toBe(1)
  })

  it('falls back to findSegmentRange when no wrap exists for the detection', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Hi Alice.</span></p>')
    const detections: Detection[] = [
      {
        id: 'a',
        segmentId: 'body/p0/r0',
        start: 3,
        end: 8,
        text: 'Alice',
        entityType: 'PERSON',
        status: 'pending',
      },
    ]
    const resolved = resolveDetections(root, detections)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.range.toString()).toBe('Alice')
    expect(resolved[0]?.range.startContainer.nodeType).toBe(Node.TEXT_NODE)
  })
})

describe('seedFakeDetections', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('finds emails, dates, and zip codes inside segment runs', () => {
    const root = setBody(`
      <p><span data-segment-id="body/p0/r0">Reach me at alice@example.com on December 22, 2025.</span></p>
      <p><span data-segment-id="body/p2/r0">Office at zip 36922-1100.</span></p>
    `)
    const seeded = seedFakeDetections(root)
    const byType = new Map<string, Detection[]>()
    for (const d of seeded) {
      const list = byType.get(d.entityType) ?? []
      list.push(d)
      byType.set(d.entityType, list)
    }
    expect(byType.get('EMAIL_ADDRESS')?.[0]?.text).toBe('alice@example.com')
    expect(byType.get('DATE_TIME')?.[0]?.text).toBe('December 22, 2025')
    expect(byType.get('US_ZIP')?.[0]?.text).toBe('36922-1100')
  })

  it('produces stable ids that disambiguate multiple matches in one run', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">a@x.com and b@y.com</span></p>')
    const seeded = seedFakeDetections(root)
    expect(seeded).toHaveLength(2)
    expect(seeded[0]!.id).not.toBe(seeded[1]!.id)
  })

  it('emits start/end offsets that point at the matched substring', () => {
    const text = 'Email me at alice@example.com please.'
    const root = setBody(`<p><span data-segment-id="body/p0/r0">${text}</span></p>`)
    const seeded = seedFakeDetections(root)
    const email = seeded.find((d) => d.entityType === 'EMAIL_ADDRESS')!
    expect(text.slice(email.start, email.end)).toBe('alice@example.com')
  })

  it('marks every seeded detection as pending so nothing arrives pre-decided', () => {
    const root = setBody(
      '<p><span data-segment-id="body/p0/r0">a@x.com on January 1, 2024 in 12345.</span></p>',
    )
    const seeded = seedFakeDetections(root)
    expect(seeded).not.toHaveLength(0)
    for (const d of seeded) expect(d.status).toBe('pending')
  })
})
