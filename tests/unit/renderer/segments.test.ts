// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  findSegmentRange,
  findSegmentRanges,
  locatorKey,
  rangeWithinElement,
  type SegmentLocator,
} from '../../../src/renderer/src/review/segments'

function setBody(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

describe('findSegmentRange', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('resolves a locator inside a single text node', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Hello, Rachel Moore!</span></p>')
    const range = findSegmentRange(root, {
      segmentId: 'body/p0/r0',
      start: 7,
      end: 19,
    })
    expect(range).not.toBeNull()
    expect(range?.toString()).toBe('Rachel Moore')
  })

  it('returns null when no run carries the segment id', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">whatever</span></p>')
    const range = findSegmentRange(root, { segmentId: 'body/p99/r0', start: 0, end: 1 })
    expect(range).toBeNull()
  })

  it('returns null when offsets fall past the run text', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">short</span></p>')
    const range = findSegmentRange(root, { segmentId: 'body/p0/r0', start: 0, end: 99 })
    expect(range).toBeNull()
  })

  it('rejects an inverted range', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">short</span></p>')
    const range = findSegmentRange(root, { segmentId: 'body/p0/r0', start: 4, end: 2 })
    expect(range).toBeNull()
  })

  it('handles attribute values that need escaping', () => {
    // Quote inside a segment id is unusual but legal — the python adapter
    // never produces one today, but the selector escape protects against
    // future formats and against malicious input.
    const root = setBody("<p><span data-segment-id='body/p0/r\"0'>quoted segment</span></p>")
    const range = findSegmentRange(root, {
      segmentId: 'body/p0/r"0',
      start: 0,
      end: 6,
    })
    expect(range?.toString()).toBe('quoted')
  })
})

describe('rangeWithinElement', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('walks across nested text nodes (e.g. bolded subspan)', () => {
    const root = setBody('<span data-segment-id="body/p0/r0">Party A: <b>Rachel</b> Moore.</span>')
    const el = root.querySelector('[data-segment-id]')!
    // textContent: "Party A: Rachel Moore."
    //               0         1         2
    //               0123456789012345678901
    // "Rachel Moore" starts at 9, ends at 21
    const range = rangeWithinElement(el, 9, 21)
    expect(range?.toString()).toBe('Rachel Moore')
  })

  it('returns null for negative start', () => {
    const root = setBody('<span data-segment-id="body/p0/r0">x</span>')
    const el = root.querySelector('[data-segment-id]')!
    expect(rangeWithinElement(el, -1, 1)).toBeNull()
  })
})

describe('findSegmentRanges', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('returns only the locators that hit, keyed by locatorKey', () => {
    const root = setBody(`
      <p><span data-segment-id="body/p0/r0">Alice met Bob.</span></p>
      <p><span data-segment-id="body/p2/r0">Carol called Dave.</span></p>
    `)
    const locators: SegmentLocator[] = [
      { segmentId: 'body/p0/r0', start: 0, end: 5 }, // "Alice"
      { segmentId: 'body/p0/r0', start: 10, end: 13 }, // "Bob"
      { segmentId: 'body/p2/r0', start: 0, end: 5 }, // "Carol"
      { segmentId: 'body/p99/r0', start: 0, end: 5 }, // miss
    ]
    const result = findSegmentRanges(root, locators)
    expect(result.size).toBe(3)
    expect(result.get(locatorKey(locators[0]!))?.toString()).toBe('Alice')
    expect(result.get(locatorKey(locators[1]!))?.toString()).toBe('Bob')
    expect(result.get(locatorKey(locators[2]!))?.toString()).toBe('Carol')
    expect(result.has(locatorKey(locators[3]!))).toBe(false)
  })
})

describe('locatorKey', () => {
  it('is stable and disambiguates overlapping spans', () => {
    expect(locatorKey({ segmentId: 'body/p0/r0', start: 0, end: 5 })).toBe('body/p0/r0:0-5')
    expect(locatorKey({ segmentId: 'body/p0/r0', start: 0, end: 6 })).toBe('body/p0/r0:0-6')
    expect(locatorKey({ segmentId: 'body/p0/r0', start: 0, end: 5 })).toBe(
      locatorKey({ segmentId: 'body/p0/r0', start: 0, end: 5 }),
    )
  })
})
