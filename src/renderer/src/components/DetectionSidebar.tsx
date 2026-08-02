import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useReviewStore } from '../review/store'
import {
  OPERATOR_NAMES,
  type Detection,
  type DetectionStatus,
  type OperatorName,
} from '../review/types'
import { useReviewActions } from '../review/use-actions'

const STATUS_LABEL: Record<DetectionStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

export interface FocusedControlsState {
  readonly editing: boolean
  readonly effectiveOperator: OperatorName
  readonly pseudonymizeLocked: boolean
  readonly defaultOperator: OperatorName
}

/**
 * Pure helper deciding what shape the focused row's controls block
 * should render in. Returns `null` for non-focused rows so callers can
 * skip the controls entirely.
 *
 * Exported for unit testing — the JSX consumer below is a thin wrapper.
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
 * Decide the visual tier for the sidebar's "→ replacement" line:
 *
 *   accepted → firm   (the decision is made; the replacement matters)
 *   rejected → muted  (greyed; user opted out, replacement is now history)
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

export function DetectionSidebar(): ReactElement {
  const detections = useReviewStore((s) => s.detections)
  const focusedId = useReviewStore((s) => s.focusedId)
  const setFocused = useReviewStore((s) => s.setFocused)
  const openCommit = useReviewStore((s) => s.openCommitPanel)
  const editingReplacementId = useReviewStore((s) => s.editingReplacementId)
  const previews = useReviewStore((s) => s.previews)
  const startEditingReplacement = useReviewStore((s) => s.startEditingReplacement)
  const defaultOperator = useReviewStore((s) => s.defaultOperator)
  const mappingUnlocked = useReviewStore((s) => s.mappingStoreUnlocked) === true
  const pendingMissedSelection = useReviewStore((s) => s.pendingMissedSelection)
  const unwrappableIds = useReviewStore((s) => s.unwrappableIds)
  const actions = useReviewActions()

  const focusedRowRef = useRef<HTMLLIElement | null>(null)
  const unwrappable = new Set(unwrappableIds)

  // Keyboard navigation and click-to-focus both move focusedId; keep the
  // matching row on screen so its Accept/Reject/Edit controls are reachable.
  // `block: 'nearest'` is a no-op when the row is already visible, so
  // clicking a row directly does not jolt the list.
  useEffect(() => {
    const row = focusedRowRef.current
    if (row === null) return
    if (typeof row.scrollIntoView !== 'function') return
    row.scrollIntoView({ block: 'nearest' })
  }, [focusedId])

  const counts = aggregate(detections)
  const canCommit = detections.length > 0 && counts.pending === 0

  return (
    <aside className="detection-sidebar" aria-label="Detection list">
      <header className="sidebar-header">
        <div className="sidebar-header-row">
          <h2>Detections</h2>
          <button
            type="button"
            className="sidebar-mark-missed"
            disabled={pendingMissedSelection === null}
            onClick={() => {
              if (pendingMissedSelection !== null) {
                actions.addMissed(pendingMissedSelection)
              }
            }}
            title={
              pendingMissedSelection === null
                ? 'Select text in the document to mark missed PII'
                : 'Mark selection as missed PII · M'
            }
          >
            + Mark missed PII
          </button>
        </div>
        <p className="sidebar-counts">
          <span>{String(counts.pending)} pending</span>
          {' · '}
          <span>{String(counts.accepted)} accepted</span>
          {' · '}
          <span>{String(counts.rejected)} rejected</span>
        </p>
      </header>
      {detections.length === 0 ? (
        <p className="sidebar-empty">No detections yet.</p>
      ) : (
        <ul className="sidebar-list">
          {detections.map((d) => {
            const focusedState = pickFocusedControlsState(
              d,
              focusedId,
              editingReplacementId,
              defaultOperator,
              mappingUnlocked,
            )
            return (
              <li key={d.id} ref={d.id === focusedId ? focusedRowRef : null}>
                <button
                  type="button"
                  className={`sidebar-item sidebar-item-${d.status}${
                    d.id === focusedId ? ' sidebar-item-focused' : ''
                  }`}
                  onClick={() => {
                    setFocused(d.id)
                  }}
                  aria-pressed={d.id === focusedId}
                >
                  <span className="sidebar-item-text">{d.text}</span>
                  <SidebarReplacementLine detection={d} preview={previews[d.id]} />
                  <span className="sidebar-item-meta">
                    <span className="sidebar-item-entity">{d.entityType}</span>
                    <span className={`sidebar-item-status sidebar-item-status-${d.status}`}>
                      {STATUS_LABEL[d.status]}
                    </span>
                    {unwrappable.has(d.id) ? (
                      <span
                        className="sidebar-item-unwrappable"
                        title="This text spans formatting in the document, so it can't be clicked or previewed inline — review it from this list."
                      >
                        <span aria-hidden="true">⚠</span>
                        <span className="visually-hidden">Not clickable in the document</span>
                      </span>
                    ) : null}
                  </span>
                </button>
                {focusedState !== null ? (
                  <FocusedControls
                    detection={d}
                    state={focusedState}
                    onSetOperator={(op) => {
                      actions.setOperator(d.id, op)
                    }}
                    onAccept={() => {
                      actions.accept(d.id)
                    }}
                    onReject={() => {
                      actions.reject(d.id)
                    }}
                    onStartEdit={() => {
                      startEditingReplacement(d.id)
                    }}
                    onCancelEdit={() => {
                      startEditingReplacement(null)
                    }}
                    onCommitReplacement={(value) => {
                      actions.setCustomReplacement(d.id, value.length === 0 ? null : value)
                      startEditingReplacement(null)
                    }}
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      <footer className="sidebar-footer">
        <button
          type="button"
          className="sidebar-commit"
          disabled={!canCommit}
          onClick={openCommit}
          title={
            canCommit
              ? 'Open commit panel (Ctrl/Cmd + Enter)'
              : 'Resolve every pending detection before committing'
          }
        >
          Commit…
        </button>
      </footer>
    </aside>
  )
}

interface FocusedControlsProps {
  readonly detection: Detection
  readonly state: FocusedControlsState
  readonly onSetOperator: (op: OperatorName) => void
  readonly onAccept: () => void
  readonly onReject: () => void
  readonly onStartEdit: () => void
  readonly onCancelEdit: () => void
  readonly onCommitReplacement: (value: string) => void
}

function FocusedControls({
  detection,
  state,
  onSetOperator,
  onAccept,
  onReject,
  onStartEdit,
  onCancelEdit,
  onCommitReplacement,
}: FocusedControlsProps): ReactElement {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const hasCustomReplacement = detection.customReplacement !== undefined

  useEffect(() => {
    if (state.editing) {
      setDraft(detection.customReplacement ?? '')
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [state.editing, detection.customReplacement])

  return (
    <div className="detection-sidebar-item-controls" data-testid="focused-controls">
      <label
        className={`detection-sidebar-item-operator${
          hasCustomReplacement ? ' detection-sidebar-item-operator-bypassed' : ''
        }`}
      >
        Operator
        <select
          value={state.effectiveOperator}
          disabled={hasCustomReplacement}
          onChange={(e) => {
            onSetOperator(e.currentTarget.value as OperatorName)
          }}
        >
          {OPERATOR_NAMES.map((op) => {
            const locked = op === 'pseudonymize' && state.pseudonymizeLocked
            const isDefault = op === state.defaultOperator && detection.operator === undefined
            return (
              <option key={op} value={op} disabled={locked}>
                {op}
                {isDefault ? ' (default)' : ''}
                {locked ? ' — mapping store locked' : ''}
              </option>
            )
          })}
        </select>
        {state.pseudonymizeLocked && state.effectiveOperator === 'pseudonymize' ? (
          <span className="detection-sidebar-item-hint">
            Unlock the mapping store before committing.
          </span>
        ) : hasCustomReplacement ? (
          <span className="detection-sidebar-item-hint">Bypassed by custom replacement below.</span>
        ) : null}
      </label>

      {state.editing ? (
        <div className="detection-sidebar-item-edit">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            placeholder="Custom replacement…"
            onChange={(e) => {
              setDraft(e.currentTarget.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onCommitReplacement(draft)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onCancelEdit()
              }
            }}
          />
          <button
            type="button"
            className="detection-sidebar-item-edit-cancel"
            onClick={onCancelEdit}
          >
            Cancel
          </button>
        </div>
      ) : hasCustomReplacement ? (
        <p className="detection-sidebar-item-replacement">
          Replace with: <code>{detection.customReplacement}</code>
          <button type="button" className="detection-sidebar-item-edit-start" onClick={onStartEdit}>
            Edit
          </button>
        </p>
      ) : (
        <button type="button" className="detection-sidebar-item-edit-start" onClick={onStartEdit}>
          Edit replacement
        </button>
      )}

      <div className="detection-sidebar-item-actions">
        <button type="button" className="detection-sidebar-item-accept" onClick={onAccept}>
          Accept ↵
        </button>
        <button type="button" className="detection-sidebar-item-reject" onClick={onReject}>
          Reject ⌫
        </button>
      </div>
    </div>
  )
}

interface SidebarReplacementLineProps {
  readonly detection: Detection
  readonly preview: string | undefined
}

function SidebarReplacementLine({
  detection,
  preview,
}: SidebarReplacementLineProps): ReactElement | null {
  const variant = pickReplacementVariant(detection, preview)
  if (variant === null) return null
  return (
    <span
      className={`sidebar-item-replacement sidebar-item-replacement-${variant}`}
      data-testid="sidebar-replacement"
    >
      → {preview}
    </span>
  )
}

function aggregate(detections: readonly Detection[]): Record<DetectionStatus, number> {
  const out: Record<DetectionStatus, number> = { pending: 0, accepted: 0, rejected: 0 }
  for (const d of detections) out[d.status]++
  return out
}
