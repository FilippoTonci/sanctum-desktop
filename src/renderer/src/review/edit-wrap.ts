/**
 * DOM-mutation pass that wraps each detection's resolved Range in
 *
 *   <span class="sanctum-edit" data-detection-id="…">
 *     <span class="sanctum-edit-original">{originalText}</span>
 *   </span>
 *
 * The wrap is structure-only — it does not set the `data-status`
 * attribute. EditReplacement (in src/renderer/src/components/) reacts
 * to store changes, sets data-status on each wrapper, and inserts a
 * sibling .sanctum-edit-replacement when a preview is available.
 *
 * The wrap survives subsequent resolve passes: wrapDetections is
 * idempotent — wrapped detections are skipped, and any wraps whose
 * detection id is no longer in the input set are unwrapped. Detections
 * are resolved one at a time inside this function (rather than taking
 * a pre-resolved list) because Range.surroundContents on one detection
 * can split text nodes and invalidate pre-built Range objects for
 * later detections in the same batch.
 *
 * Range.surroundContents throws InvalidStateError when the range's two
 * endpoints do not share a parent node. We catch that and skip, and the
 * skipped ids are returned so callers can tell the difference between
 * "wrapped everything" and "silently gave up on some".
 *
 * When can that actually happen? Not on formatting alone: a segment is
 * one docx run (ids look like `body/p2/r1`), so a bold span *ends* the
 * segment rather than splitting one. A detection's [start, end) is
 * always inside a single run, and a range inside one run's text node
 * has one parent. The reachable case is a range that spans a
 * `.sanctum-edit` wrap inserted earlier in the same pass — i.e. a
 * detection overlapping one already wrapped in that segment.
 *
 * Manual testing against a real .docx (2026-08-03, issue #29) could not
 * produce a throw: 33 detections across 13 segments all wrapped, six in
 * a single segment, including a deliberately constructed user-added
 * span crossing an existing wrap. Treat this as a safety net, not a
 * routine path — and if you find input that trips it, record it here.
 *
 * A skipped detection still gets painted by the highlight registries,
 * still carries its proposed replacement in the sidebar, and Accept
 * still records the decision. What it loses is the in-document
 * substitution and click-to-focus, since the CSS Custom Highlight API
 * is not hit-testable.
 */

import { findSegmentRange } from './segments'
import type { Detection } from './types'

const EDIT_CLASS = 'sanctum-edit'
const ORIGINAL_CLASS = 'sanctum-edit-original'
const DATA_DETECTION_ID = 'data-detection-id'

/**
 * Wrap each detection in a `.sanctum-edit` span.
 * Idempotent: existing wraps with matching detection ids are left alone,
 * and stale wraps (id not in `detections`) are unwrapped.
 */
export function wrapDetections(
  root: ParentNode,
  detections: readonly Detection[],
): readonly string[] {
  const unwrappable: string[] = []
  const wantedIds = new Set(detections.map((d) => d.id))

  // Unwrap stale wraps first — clears the way for fresh ones.
  const existing = root.querySelectorAll<HTMLElement>(`.${EDIT_CLASS}[${DATA_DETECTION_ID}]`)
  for (const wrap of existing) {
    const id = wrap.getAttribute(DATA_DETECTION_ID)
    if (id !== null && !wantedIds.has(id)) {
      unwrapOne(wrap)
    }
  }

  // Wrap any detection that doesn't yet have one. We resolve each
  // detection inside the loop because surroundContents on an earlier
  // detection mutates the underlying text nodes and would invalidate
  // pre-built Range objects for later ones.
  for (const detection of detections) {
    if (
      root.querySelector(`.${EDIT_CLASS}[${DATA_DETECTION_ID}="${escapeAttr(detection.id)}"]`) !==
      null
    ) {
      continue
    }

    const range = findSegmentRange(root, {
      segmentId: detection.segmentId,
      start: detection.start,
      end: detection.end,
    })
    if (range === null) continue

    const ownerDoc = ownerDocumentOf(root)
    if (ownerDoc === null) continue

    const outer = ownerDoc.createElement('span')
    outer.className = EDIT_CLASS
    outer.setAttribute(DATA_DETECTION_ID, detection.id)

    try {
      range.surroundContents(outer)
    } catch {
      // Range.surroundContents throws InvalidStateError when the range
      // straddles element boundaries. Report it — see module-level JSDoc.
      unwrappable.push(detection.id)
      continue
    }

    // Move the wrapped contents into a child .sanctum-edit-original so
    // CSS can hide them via [data-status="accepted"] without touching
    // the replacement sibling that EditReplacement will add.
    const inner = ownerDoc.createElement('span')
    inner.className = ORIGINAL_CLASS
    while (outer.firstChild !== null) {
      inner.appendChild(outer.firstChild)
    }
    outer.appendChild(inner)
  }

  return unwrappable
}

/**
 * Remove every `.sanctum-edit` wrapper inside `root`, restoring the
 * original text nodes in their place. Used on full teardown (e.g.
 * before re-rendering the docx).
 */
export function unwrapAll(root: ParentNode): void {
  const wraps = root.querySelectorAll<HTMLElement>(`.${EDIT_CLASS}`)
  for (const wrap of wraps) {
    unwrapOne(wrap)
  }
}

function unwrapOne(outer: HTMLElement): void {
  const parent = outer.parentNode
  if (parent === null) return
  const inner = outer.querySelector<HTMLElement>(`:scope > .${ORIGINAL_CLASS}`)
  if (inner !== null) {
    while (inner.firstChild !== null) {
      parent.insertBefore(inner.firstChild, outer)
    }
  }
  parent.removeChild(outer)
}

function ownerDocumentOf(root: ParentNode): Document | null {
  if (root instanceof Document) return root
  if (root instanceof Element) return root.ownerDocument
  if (root instanceof DocumentFragment) return root.ownerDocument
  return null
}

/**
 * Escape an attribute value for inclusion in a CSS attribute selector.
 * Detection ids today are URL-safe, but the contract is open-ended,
 * matching the same defensive escape `findSegmentElement` uses.
 */
function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, (m) => `\\${m}`)
}
