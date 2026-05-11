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
 * Snapshot the rendered segment ids in document order. Used by the
 * review store to insert user-added detections (and re-sort resumed
 * sessions where backend ships proposals first / user-added last) into
 * the right spot in the sidebar, so arrow-down keeps marching forward
 * through the document instead of jumping to a trailing USER_ADDED row.
 */
export function extractSegmentOrder(root: ParentNode): string[] {
  const out: string[] = []
  for (const el of root.querySelectorAll<HTMLElement>('[data-segment-id]')) {
    const id = el.getAttribute('data-segment-id')
    if (id !== null) out.push(id)
  }
  return out
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
  const walker = createSegmentTextWalker(doc, el)

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

/**
 * Inverse of `findSegmentRange`: turn a user-made Range (typically from
 * `window.getSelection`) into a locator anchored on the run that
 * contains it. Returns `null` when the range is collapsed, falls
 * outside any tagged segment, or straddles two segments — the user has
 * to pick a span inside a single run for the locator to be meaningful.
 */
export function rangeToLocator(range: Range, root: ParentNode): SegmentLocator | null {
  if (range.collapsed) return null

  const startSegment = nearestSegmentAncestor(range.startContainer, root)
  const endSegment = nearestSegmentAncestor(range.endContainer, root)
  if (startSegment === null || endSegment === null) return null
  if (startSegment !== endSegment) return null

  const segmentId = startSegment.getAttribute('data-segment-id')
  if (segmentId === null) return null

  const start = textOffsetWithin(startSegment, range.startContainer, range.startOffset)
  const end = textOffsetWithin(startSegment, range.endContainer, range.endOffset)
  if (start === null || end === null || start === end) return null

  return { segmentId, start, end }
}

function nearestSegmentAncestor(node: Node, root: ParentNode): HTMLElement | null {
  let current: Node | null = node
  while (current !== null && current !== root) {
    if (current instanceof HTMLElement && current.hasAttribute('data-segment-id')) return current
    current = current.parentNode
  }
  return null
}

function textOffsetWithin(host: Element, target: Node, targetOffset: number): number | null {
  const doc = host.ownerDocument
  const walker = createSegmentTextWalker(doc, host)
  let consumed = 0
  for (
    let node = walker.nextNode() as Text | null;
    node !== null;
    node = walker.nextNode() as Text | null
  ) {
    if (node === target) return consumed + targetOffset
    consumed += node.data.length
  }
  // Caller passed a target that is not a descendant of host, or is an
  // element node: treat the offset as positions within child nodes.
  if (target instanceof Element && target === host) {
    let acc = 0
    const childWalker = createSegmentTextWalker(doc, host)
    let child = childWalker.nextNode() as Text | null
    let i = 0
    while (child !== null && i < targetOffset) {
      acc += child.data.length
      child = childWalker.nextNode() as Text | null
      i++
    }
    return acc
  }
  return null
}

/**
 * Return the substring of `segmentId`'s textContent covering
 * `[locator.start, locator.end)`, using the same filtered tree-walker
 * that `rangeWithinElement` uses (i.e. skipping
 * `.sanctum-edit-replacement` children). This is the canonical way to
 * extract the raw text behind a locator regardless of which detections
 * have been wrapped or accepted.
 *
 * Returns `null` if the segment is missing, the offsets fall outside
 * the segment's filtered text length, or `start`/`end` are malformed.
 * Returns `''` when `start === end` (collapsed locator).
 */
export function sliceSegmentText(root: ParentNode, locator: SegmentLocator): string | null {
  if (locator.start < 0 || locator.end < locator.start) return null
  const segEl = findSegmentElement(root, locator.segmentId)
  if (segEl === null) return null

  const doc = segEl.ownerDocument

  // Pass 1: compute total filtered length so we can validate offsets.
  let totalLength = 0
  const lengthWalker = createSegmentTextWalker(doc, segEl)
  for (
    let node = lengthWalker.nextNode() as Text | null;
    node !== null;
    node = lengthWalker.nextNode() as Text | null
  ) {
    totalLength += node.data.length
  }
  if (locator.end > totalLength) return null
  if (locator.start === locator.end) return ''

  // Pass 2: slice.
  const walker = createSegmentTextWalker(doc, segEl)
  let consumed = 0
  let out = ''
  for (
    let node = walker.nextNode() as Text | null;
    node !== null;
    node = walker.nextNode() as Text | null
  ) {
    const len = node.data.length
    const nodeStart = consumed
    const nodeEnd = consumed + len
    if (nodeEnd <= locator.start) {
      consumed = nodeEnd
      continue
    }
    if (nodeStart >= locator.end) break
    const a = Math.max(0, locator.start - nodeStart)
    const b = Math.min(len, locator.end - nodeStart)
    out += node.data.slice(a, b)
    consumed = nodeEnd
  }
  return out
}

/**
 * Build a TreeWalker that visits every text node inside `host` *except*
 * those inside `.sanctum-edit-replacement`. The replacement spans hold
 * substituted text rendered by EditReplacement; including their
 * characters in offset math would invalidate the (segmentId, start, end)
 * contract on subsequent resolves. See the design spec.
 */
function createSegmentTextWalker(doc: Document, host: Element): TreeWalker {
  return doc.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent: Node | null = node.parentNode
      while (parent !== null && parent !== host) {
        if (parent instanceof Element && parent.classList.contains('sanctum-edit-replacement')) {
          return NodeFilter.FILTER_REJECT
        }
        parent = parent.parentNode
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
}
