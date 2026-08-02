/**
 * Map a click inside the rendered document onto the detection it hit.
 *
 * Hit testing rides on the `.sanctum-edit[data-detection-id]` wraps that
 * `review/edit-wrap.ts` inserts around each detection. Walking up from
 * the event target means a click on the inline replacement preview
 * (`.sanctum-edit-replacement`, a child of the wrap) resolves to the same
 * detection as a click on the original text — which is the case issue #29
 * reported.
 *
 * A non-collapsed selection means the pointer just finished a drag-select.
 * That selection feeds the "+ Mark missed PII" flow via
 * `review/selection-tracker.ts`, so we return null rather than moving focus
 * out from under a selection the reviewer is about to act on.
 *
 * Returning null for a click on blank document space is deliberate: focus
 * stays where it is. `Esc` (see `review/keyboard.ts`) remains the single
 * explicit way to clear focus.
 */

const EDIT_SELECTOR = '.sanctum-edit[data-detection-id]'
const DATA_DETECTION_ID = 'data-detection-id'

export function detectionIdFromClick(
  target: EventTarget | null,
  selectionCollapsed: boolean,
): string | null {
  if (!selectionCollapsed) return null
  if (!(target instanceof Element)) return null
  const wrap = target.closest(EDIT_SELECTOR)
  if (wrap === null) return null
  return wrap.getAttribute(DATA_DETECTION_ID)
}
