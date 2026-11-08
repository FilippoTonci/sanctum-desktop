import { useEffect, type ReactElement } from 'react'
import { useReviewStore } from '../review/store'
import type { Detection } from '../review/types'

interface EditReplacementProps {
  /** The DocxView body element where wraps were emitted. */
  readonly anchorRoot: HTMLElement | null
}

/**
 * Reacts to store changes and decorates the `.sanctum-edit` wrappers
 * (emitted by review/edit-wrap.ts) with per-detection state:
 *
 *   - sets data-status on each wrap (only `accepted` when a preview is
 *     also available, so the original keeps showing if the backend
 *     hasn't supplied a replacement yet)
 *   - inserts/updates/removes a sibling `.sanctum-edit-replacement`
 *     inside each wrap, holding the proposed replacement text
 *
 * Visual swap is pure CSS (`[data-status="accepted"]` rules in
 * index.css). This component renders no DOM of its own.
 */
export function EditReplacement({ anchorRoot }: EditReplacementProps): ReactElement | null {
  const detections = useReviewStore((s) => s.detections)
  const previews = useReviewStore((s) => s.previews)

  useEffect(() => {
    if (anchorRoot === null) return
    applyEditDecorations(anchorRoot, detections, previews)
  }, [anchorRoot, detections, previews])

  return null
}

const EDIT_SELECTOR = '.sanctum-edit'
const REPLACEMENT_CLASS = 'sanctum-edit-replacement'

/**
 * Pure DOM mutation that drives the visual state of every
 * `.sanctum-edit` wrap inside `root`. Idempotent — call again with
 * fresh inputs to update.
 *
 * Exported for unit testing alongside the React component.
 */
export function applyEditDecorations(
  root: ParentNode,
  detections: readonly Detection[],
  previews: Readonly<Record<string, string>>,
): void {
  const byId = new Map<string, Detection>()
  for (const d of detections) byId.set(d.id, d)

  const wraps = root.querySelectorAll<HTMLElement>(EDIT_SELECTOR)
  for (const wrap of wraps) {
    const id = wrap.dataset.detectionId
    if (id === undefined) continue
    const detection = byId.get(id)
    const preview = previews[id]

    // data-status: only "accepted" when both the detection is accepted
    // AND a preview is available. Otherwise the wrap keeps the original
    // visible regardless of decision (matches the design spec's
    // standalone-fake / preview-not-yet-loaded fallback).
    if (detection?.status === 'accepted' && preview !== undefined) {
      wrap.dataset.status = 'accepted'
    } else {
      delete wrap.dataset.status
    }

    // Replacement DOM: present iff a preview exists for this id.
    let replacement = wrap.querySelector<HTMLElement>(`:scope > .${REPLACEMENT_CLASS}`)
    if (preview === undefined) {
      replacement?.remove()
      continue
    }
    if (replacement === null) {
      const ownerDoc = wrap.ownerDocument
      replacement = ownerDoc.createElement('span')
      replacement.className = REPLACEMENT_CLASS
      wrap.appendChild(replacement)
    }
    if (replacement.textContent !== preview) {
      replacement.textContent = preview
    }
  }
}
