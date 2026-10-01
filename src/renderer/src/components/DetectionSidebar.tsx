import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { countDetections, decideAllPendingOfType } from '../review/bulk'
import { entityLabel } from '../review/entities'
import { useReviewStore } from '../review/store'
import type { Detection, DetectionStatus, OperatorName } from '../review/types'
import { useReviewActions } from '../review/use-actions'
import { Icon } from './Icon'

export const STATUS_LABEL: Record<DetectionStatus, string> = {
  pending: 'To review',
  accepted: 'Redacted',
  rejected: 'Kept',
}

export interface FocusedControlsState {
  readonly editing: boolean
  readonly effectiveOperator: OperatorName
  readonly pseudonymizeLocked: boolean
  readonly defaultOperator: OperatorName
}

/**
 * Pure helper deciding what shape the focused detection's controls
 * should render in (the Inspector consumes it). Returns `null` for
 * non-focused rows so callers can skip the controls entirely.
 *
 * Operator fields survive for the engine contract; the UI only ever
 * uses `replace`, so the Inspector reads `editing` and nothing else.
 */
export function pickFocusedControlsState(
  detection: Detection,
  focusedId: string | null,
  editingReplacementId: string | null,
  defaultOperator: OperatorName,
  mappingUnlocked: boolean,
): FocusedControlsState | null {
  if (detection.id !== focusedId) return null
  const effectiveOperator = detection.operator ?? defaultOperator
  return {
    editing: editingReplacementId === detection.id,
    effectiveOperator,
    pseudonymizeLocked: effectiveOperator === 'pseudonymize' && !mappingUnlocked,
    defaultOperator,
  }
}

export type ReplacementVariant = 'firm' | 'faint' | 'muted'

/**
 * Visual tier for a replacement preview:
 *
 *   accepted → firm   (the decision is made; the replacement matters)
 *   rejected → muted  (user opted out, replacement is now history)
 *   pending  → faint  (preview hint, not yet decided)
 *
 * Returns `null` when there's no preview to render.
 */
export function pickReplacementVariant(
  detection: Detection,
  preview: string | undefined,
): ReplacementVariant | null {
  if (preview === undefined) return null
  if (detection.status === 'accepted') return 'firm'
  if (detection.status === 'rejected') return 'muted'
  return 'faint'
}

type Filter = 'all' | DetectionStatus

const FILTERS: readonly { readonly id: Filter; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'To review' },
  { id: 'accepted', label: 'Redacted' },
  { id: 'rejected', label: 'Kept' },
]

interface Group {
  readonly type: string
  readonly items: readonly Detection[]
  readonly pending: number
}

/** Group detections by entity type, groups ordered by first appearance. */
function groupByType(detections: readonly Detection[]): Group[] {
  const map = new Map<string, Detection[]>()
  for (const d of detections) {
    const list = map.get(d.entityType)
    if (list === undefined) map.set(d.entityType, [d])
    else list.push(d)
  }
  return [...map.entries()].map(([type, items]) => ({
    type,
    items,
    pending: items.filter((d) => d.status === 'pending').length,
  }))
}

/**
 * The document's detections as a layer list: grouped by entity type,
 * filterable by status, with per-group bulk actions. Lives in the left
 * sidebar during review; the right-hand Inspector edits the focused one.
 */
export function DetectionSidebar(): ReactElement {
  const detections = useReviewStore((s) => s.detections)
  const focusedId = useReviewStore((s) => s.focusedId)
  const setFocused = useReviewStore((s) => s.setFocused)
  const previews = useReviewStore((s) => s.previews)
  const pendingMissedSelection = useReviewStore((s) => s.pendingMissedSelection)
  const actions = useReviewActions()

  const [filter, setFilter] = useState<Filter>('all')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const focusedRowRef = useRef<HTMLLIElement | null>(null)

  const counts = countDetections(detections)
  const focused = detections.find((d) => d.id === focusedId)
  const focusedType = focused?.entityType

  // A collapsed group must never hide the row keyboard focus lands on.
  useEffect(() => {
    if (focusedType === undefined) return
    setCollapsed((prev) => {
      if (!prev.has(focusedType)) return prev
      const next = new Set(prev)
      next.delete(focusedType)
      return next
    })
  }, [focusedType])

  // Keyboard navigation and click-to-focus both move focusedId; keep the
  // matching row on screen. `block: 'nearest'` is a no-op when the row is
  // already visible, so clicking a row directly does not jolt the list.
  useEffect(() => {
    const row = focusedRowRef.current
    if (row === null) return
    if (typeof row.scrollIntoView !== 'function') return
    row.scrollIntoView({ block: 'nearest' })
  }, [focusedId])

  const groups = useMemo(() => {
    const visible = filter === 'all' ? detections : detections.filter((d) => d.status === filter)
    return groupByType(visible)
  }, [detections, filter])

  const toggleGroup = (type: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  return (
    <section className="detections" aria-label="Detection list">
      <header className="panel-head">
        <h2 className="panel-title">
          Detections <span className="panel-count">{String(counts.total)}</span>
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          disabled={pendingMissedSelection === null}
          onClick={() => {
            if (pendingMissedSelection !== null) actions.addMissed(pendingMissedSelection)
          }}
          title={
            pendingMissedSelection === null
              ? 'Select text in the document first, then press M'
              : 'Mark the selected text as missed PII (M)'
          }
        >
          <Icon name="marker" size={14} />
          Mark missed PII
        </button>
      </header>

      <div className="segmented segmented-sm" role="radiogroup" aria-label="Filter detections">
        {FILTERS.map((f) => {
          const n =
            f.id === 'all'
              ? counts.total
              : f.id === 'pending'
                ? counts.pending
                : f.id === 'accepted'
                  ? counts.accepted
                  : counts.rejected
          return (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filter === f.id}
              className="segmented-item"
              onClick={() => {
                setFilter(f.id)
              }}
            >
              {f.label}
              {/* "All" needs no count: the panel head already shows the total. */}
              {f.id !== 'all' && <span className="segmented-count">{String(n)}</span>}
            </button>
          )
        })}
      </div>

      {detections.length === 0 ? (
        <p className="panel-empty">No detections yet.</p>
      ) : groups.length === 0 ? (
        <p className="panel-empty">Nothing in this filter.</p>
      ) : (
        <div className="detection-groups">
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.type)
            return (
              <div key={g.type} className="detection-group">
                <div className="group-head">
                  <button
                    type="button"
                    className="group-toggle"
                    aria-expanded={!isCollapsed}
                    onClick={() => {
                      toggleGroup(g.type)
                    }}
                  >
                    <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={12} />
                    <span className="group-name">{entityLabel(g.type)}</span>
                    <span className="group-count">{String(g.items.length)}</span>
                  </button>
                  {g.pending > 0 ? (
                    <button
                      type="button"
                      className="group-bulk"
                      onClick={() => {
                        decideAllPendingOfType(detections, g.type, 'accept', actions)
                      }}
                      title={`Redact the ${String(g.pending)} ${entityLabel(g.type)} detections still to review (Shift+A)`}
                    >
                      Redact all
                    </button>
                  ) : null}
                </div>
                {isCollapsed ? null : (
                  <ul className="detection-rows">
                    {g.items.map((d) => {
                      const isFocused = d.id === focusedId
                      const variant = pickReplacementVariant(d, previews[d.id])
                      return (
                        <li key={d.id} ref={isFocused ? focusedRowRef : null}>
                          <button
                            type="button"
                            className={`detection-row status-${d.status}${
                              isFocused ? ' is-focused' : ''
                            }`}
                            aria-pressed={isFocused}
                            onClick={() => {
                              setFocused(d.id)
                            }}
                          >
                            <StatusGlyph status={d.status} />
                            <span className="detection-row-text">{d.text}</span>
                            {variant === 'firm' ? (
                              <span
                                className="detection-row-token"
                                data-testid="sidebar-replacement"
                              >
                                {d.customReplacement ?? previews[d.id]}
                              </span>
                            ) : null}
                            <span className="visually-hidden">{STATUS_LABEL[d.status]}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function StatusGlyph({ status }: { readonly status: DetectionStatus }): ReactElement {
  return (
    <span className={`status-glyph status-glyph-${status}`} aria-hidden="true">
      {status === 'accepted' ? <Icon name="check" size={10} /> : null}
    </span>
  )
}
