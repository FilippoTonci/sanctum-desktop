/**
 * Maps backend segment anchors onto the rendered docx-preview DOM.
 *
 * The Python adapter assigns each docx run a stable id (see
 * `sanctum/sanctum/documents/docx_adapter.py`) and the WS4-1 patch
 * mirrors that id onto each rendered <span> as `data-segment-id`.
 * Detections arrive from the backend as (segmentId, start, end) tuples
 * referenced against the segment's plain-text content; this module
 * resolves those tuples into DOM Ranges suitable for CSS Custom
 * Highlight registries (slice 4) and the tooltip / sidebar (slice 5).
 */

export interface SegmentLocator {
  readonly segmentId: string
  /** Inclusive char offset within the segment's textContent. */
  readonly start: number
  /** Exclusive char offset within the segment's textContent. */
  readonly end: number
}

/**
 * Look up the rendered run for `segmentId` and return a Range covering
 * `[start, end]` within its textContent. Returns `null` when the segment
 * is not present (e.g. detection arrived for a run that is not currently
 * rendered) or the offsets fall outside the run's text.
 */
export function findSegmentRange(root: ParentNode, locator: SegmentLocator): Range | null {
  const runEl = findSegmentElement(root, locator.segmentId)
  if (runEl === null) return null
  return rangeWithinElement(runEl, locator.start, locator.end)
}

/**
 * Locate the rendered <span> for a given segment id. Compares the
 * attribute value directly rather than using a CSS selector, since
 * segment ids can in principle contain characters that need CSS
 * escaping (the python adapter does not produce them today, but the
 * data-segment-id contract is open-ended).
 */
export function findSegmentElement(root: ParentNode, segmentId: string): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>('[data-segment-id]')
  for (const el of candidates) {
    if (el.getAttribute('data-segment-id') === segmentId) return el
  }
  return null
}

/**
 * Build a Range covering `[start, end]` in the textContent of `el`,
 * walking nested text nodes. Returns `null` if the offsets exceed the
 * element's text length or the range collapses to nothing.
 */
export function rangeWithinElement(el: Element, start: number, end: number): Range | null {
  if (start < 0 || end < start) return null

  const doc = el.ownerDocument
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT)

  let consumed = 0
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  for (
    let node = walker.nextNode() as Text | null;
    node !== null;
    node = walker.nextNode() as Text | null
  ) {
    const len = node.data.length
    const nodeStart = consumed
    const nodeEnd = consumed + len

    if (startNode === null && start <= nodeEnd) {
      startNode = node
      startOffset = Math.max(0, start - nodeStart)
    }
    if (end <= nodeEnd) {
      endNode = node
      endOffset = end - nodeStart
      break
    }
    consumed = nodeEnd
  }

  if (startNode === null || endNode === null) return null

  const range = doc.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

/**
 * Resolve every locator in batch, returning only the ones that hit. The
 * caller decides what to do with misses (typically: log + skip rendering).
 */
export function findSegmentRanges(
  root: ParentNode,
  locators: readonly SegmentLocator[],
): Map<string, Range> {
  const out = new Map<string, Range>()
  for (const loc of locators) {
    const range = findSegmentRange(root, loc)
    if (range !== null) out.set(locatorKey(loc), range)
  }
  return out
}

/**
 * Stable cache key for a locator. Used as the map key in
 * `findSegmentRanges` so callers can correlate locator → range without
 * passing the locator object through.
 */
export function locatorKey(loc: SegmentLocator): string {
  return `${loc.segmentId}:${String(loc.start)}-${String(loc.end)}`
}
