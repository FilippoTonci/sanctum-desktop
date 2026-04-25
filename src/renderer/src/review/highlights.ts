/**
 * Drive the CSS Custom Highlight API from a list of detections.
 *
 * Four registries are maintained:
 *
 *   sanctum-pending   — detections the reviewer hasn't acted on
 *   sanctum-accepted  — detections the reviewer marked accept
 *   sanctum-rejected  — detections the reviewer marked reject
 *   sanctum-focused   — the single detection currently focused (overlay
 *                        on top of one of the three above)
 *
 * The CSS in `index.css` paints each registry. The renderer just owns
 * which Range goes into which registry on every state change.
 */

import { findSegmentRange } from './segments'
import type { Detection } from './types'

const REGISTRY_NAMES = {
  pending: 'sanctum-pending',
  accepted: 'sanctum-accepted',
  rejected: 'sanctum-rejected',
  focused: 'sanctum-focused',
} as const

type RegistryName = (typeof REGISTRY_NAMES)[keyof typeof REGISTRY_NAMES]

export interface ResolvedDetection {
  readonly detection: Detection
  readonly range: Range
}

/**
 * Resolve every detection to a DOM Range against `root`. Returns the
 * subset that hit (a detection whose run is not currently rendered is
 * silently dropped — common during async docx-preview render warmup).
 */
export function resolveDetections(
  root: ParentNode,
  detections: readonly Detection[],
): ResolvedDetection[] {
  const out: ResolvedDetection[] = []
  for (const detection of detections) {
    const range = findSegmentRange(root, {
      segmentId: detection.segmentId,
      start: detection.start,
      end: detection.end,
    })
    if (range !== null) out.push({ detection, range })
  }
  return out
}

/**
 * Push the resolved ranges into the four CSS Custom Highlight
 * registries. Idempotent — call this on every detection or focus
 * change. Returns `false` when the platform lacks Highlight API
 * support (older browsers, happy-dom under unit test); callers should
 * fall back to no-overlay mode in that case.
 */
export function applyHighlightRegistries(
  resolved: readonly ResolvedDetection[],
  focusedId: string | null,
): boolean {
  if (!hasHighlightApi()) return false

  const registry: Record<RegistryName, Highlight> = {
    [REGISTRY_NAMES.pending]: ensureRegistry(REGISTRY_NAMES.pending),
    [REGISTRY_NAMES.accepted]: ensureRegistry(REGISTRY_NAMES.accepted),
    [REGISTRY_NAMES.rejected]: ensureRegistry(REGISTRY_NAMES.rejected),
    [REGISTRY_NAMES.focused]: ensureRegistry(REGISTRY_NAMES.focused),
  }

  for (const name of Object.values(REGISTRY_NAMES)) {
    registry[name].clear()
  }

  for (const { detection, range } of resolved) {
    registry[REGISTRY_NAMES[detection.status]].add(range)
    if (detection.id === focusedId) {
      registry[REGISTRY_NAMES.focused].add(range)
    }
  }

  return true
}

function ensureRegistry(name: RegistryName): Highlight {
  const existing = CSS.highlights.get(name)
  if (existing !== undefined) return existing
  const created = new Highlight()
  CSS.highlights.set(name, created)
  return created
}

function hasHighlightApi(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof Highlight !== 'undefined' &&
    typeof CSS.highlights !== 'undefined'
  )
}
