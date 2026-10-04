import { useEffect, useRef, useState, type ReactElement } from 'react'
import { countDetections, decideAllPendingOfType, idsOfType } from '../review/bulk'
import { entityLabel } from '../review/entities'
import { useReviewStore } from '../review/store'
import { findingText, headsOf, type Detection } from '../review/types'
import { useReviewActions } from '../review/use-actions'
import { pickFocusedControlsState, STATUS_LABEL, StatusGlyph } from './DetectionSidebar'
import { Icon, Kbd } from './Icon'

/**
 * Right-hand inspector: everything about the focused detection — what
 * was found, what it becomes, the verdict buttons, and the bulk
 * actions for its entity type. Every control names its shortcut.
 */
export function Inspector(): ReactElement {
  const detections = useReviewStore((s) => s.detections)
  const focusedId = useReviewStore((s) => s.focusedId)
  const previews = useReviewStore((s) => s.previews)
  const editingReplacementId = useReviewStore((s) => s.editingReplacementId)
  const defaultOperator = useReviewStore((s) => s.defaultOperator)
  const focusNext = useReviewStore((s) => s.focusNext)
  const focusPrev = useReviewStore((s) => s.focusPrev)

  // Findings, not pieces: a linked finding is numbered and shown once.
  const findings = headsOf(detections)
  const index = findings.findIndex((d) => d.id === focusedId)
  const detection = index === -1 ? undefined : findings[index]

  return (
    <aside className="inspector" aria-label="Inspector">
      <header className="panel-head inspector-head">
        <h2 className="panel-title">
          {detection === undefined
            ? 'Inspector'
            : `Detection ${String(index + 1)} of ${String(findings.length)}`}
        </h2>
        <div className="inspector-nav">
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={focusPrev}
            disabled={detections.length === 0}
            aria-label="Previous detection"
            title="Previous detection (↑)"
          >
            <Icon name="chevronUp" />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={focusNext}
            disabled={detections.length === 0}
            aria-label="Next detection"
            title="Next detection (↓)"
          >
            <Icon name="chevronDown" />
          </button>
        </div>
      </header>
      {detection === undefined ? (
        <InspectorEmpty hasDetections={detections.length > 0} />
      ) : (
        <FocusedDetection
          key={detection.id}
          detection={detection}
          detections={detections}
          preview={previews[detection.id]}
          editing={
            pickFocusedControlsState(
              detection,
              focusedId,
              editingReplacementId,
              defaultOperator,
              false,
            )?.editing ?? false
          }
        />
      )}
    </aside>
  )
}

interface FocusedDetectionProps {
  readonly detection: Detection
  readonly detections: readonly Detection[]
  readonly preview: string | undefined
  readonly editing: boolean
}

function FocusedDetection({
  detection,
  detections,
  preview,
  editing,
}: FocusedDetectionProps): ReactElement {
  const actions = useReviewActions()
  const startEditing = useReviewStore((s) => s.startEditingReplacement)
  const focusNextPending = useReviewStore((s) => s.focusNextPending)

  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!editing) return
    setDraft(detection.customReplacement ?? preview ?? '')
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing, detection.customReplacement, preview])

  const replacement = detection.customReplacement ?? preview
  const hasCustom = detection.customReplacement !== undefined
  const label = entityLabel(detection.entityType)
  const sameType = idsOfType(detections, detection.entityType)
  const sameTypePending = idsOfType(detections, detection.entityType, 'pending')

  const commit = (value: string): void => {
    const trimmed = value.trim()
    // Typing the default back in (or clearing the field) resets to default.
    actions.setCustomReplacement(
      detection.id,
      trimmed.length === 0 || (!hasCustom && trimmed === preview) ? null : trimmed,
    )
    startEditing(null)
  }

  return (
    <div className="inspector-body">
      <section className="inspector-section">
        <div className="inspector-meta">
          <span className="entity-chip">{label}</span>
          <span className={`status-pill status-pill-${detection.status}`}>
            <StatusGlyph status={detection.status} />
            {STATUS_LABEL[detection.status]}
          </span>
        </div>
        <p className="inspector-subject">{findingText(detection)}</p>
      </section>

      <section className="inspector-section">
        <div className="field-head">
          <span className="field-label" id="replacement-label">
            Replaced with
          </span>
          {hasCustom && !editing ? <span className="field-note">Edited</span> : null}
        </div>
        {editing ? (
          <div className="replacement-edit">
            <input
              ref={inputRef}
              type="text"
              className="input input-mono"
              aria-labelledby="replacement-label"
              value={draft}
              placeholder={preview ?? 'Replacement text'}
              onChange={(e) => {
                setDraft(e.currentTarget.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commit(draft)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  startEditing(null)
                }
              }}
            />
            <p className="field-hint">
              <Kbd keys={['↵']} /> save <Kbd keys={['esc']} /> cancel
            </p>
          </div>
        ) : (
          <button
            type="button"
            className="replacement-display"
            onClick={() => {
              startEditing(detection.id)
            }}
            title="Edit replacement (E)"
          >
            <span className="token">{replacement ?? '—'}</span>
            <span className="replacement-edit-hint">
              Edit <Kbd keys={['E']} />
            </span>
          </button>
        )}
        {hasCustom && !editing ? (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              actions.setCustomReplacement(detection.id, null)
            }}
          >
            Reset to default
          </button>
        ) : null}
      </section>

      <section className="inspector-section inspector-actions">
        <button
          type="button"
          className={`btn btn-primary btn-block${detection.status === 'accepted' ? ' is-current' : ''}`}
          onClick={() => {
            actions.accept(detection.id)
            focusNextPending()
          }}
        >
          Redact
          <Kbd keys={['↵']} />
        </button>
        <button
          type="button"
          className={`btn btn-secondary btn-block${detection.status === 'rejected' ? ' is-current' : ''}`}
          onClick={() => {
            actions.reject(detection.id)
            focusNextPending()
          }}
        >
          Keep original
          <Kbd keys={['⌫']} />
        </button>
      </section>

      <section className="inspector-section">
        <div className="field-head">
          <span className="field-label">Every {label} in this document</span>
          <span className="field-note mono">
            {String(sameType.length - sameTypePending.length)}/{String(sameType.length)} reviewed
          </span>
        </div>
        <div className="bulk-row">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={sameTypePending.length === 0}
            onClick={() => {
              decideAllPendingOfType(detections, detection.entityType, 'accept', actions)
            }}
          >
            Redact all
            <Kbd keys={['⇧', 'A']} />
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={sameTypePending.length === 0}
            onClick={() => {
              decideAllPendingOfType(detections, detection.entityType, 'reject', actions)
            }}
          >
            Keep all
            <Kbd keys={['⇧', 'R']} />
          </button>
        </div>
        <p className="field-hint">Applies only to the ones still to review.</p>
      </section>
    </div>
  )
}

function InspectorEmpty({ hasDetections }: { readonly hasDetections: boolean }): ReactElement {
  const detections = useReviewStore((s) => s.detections)
  const counts = countDetections(detections)
  return (
    <div className="inspector-body inspector-empty">
      <p className="inspector-empty-title">
        {hasDetections ? 'Nothing selected' : 'No detections'}
      </p>
      <p className="field-hint">
        {hasDetections
          ? `${String(counts.pending)} still to review. Press N to jump to the next one, or click a highlight in the document.`
          : 'Select any text the engine missed and press M to mark it.'}
      </p>
      <ShortcutList />
    </div>
  )
}

export const REVIEW_SHORTCUTS: readonly {
  readonly keys: readonly string[]
  readonly label: string
}[] = [
  { keys: ['↓', '↑'], label: 'Next / previous detection' },
  { keys: ['N'], label: 'Next one to review' },
  { keys: ['↵'], label: 'Redact and move on' },
  { keys: ['⌫'], label: 'Keep original and move on' },
  { keys: ['⇧', 'A'], label: 'Redact all of this type' },
  { keys: ['E'], label: 'Edit replacement' },
  { keys: ['M'], label: 'Mark selected text as missed' },
  { keys: ['⌘', 'Z'], label: 'Undo' },
  { keys: ['⌘', 'S'], label: 'Save redacted copy' },
  { keys: ['⌘', 'K'], label: 'All commands' },
]

function ShortcutList(): ReactElement {
  return (
    <dl className="shortcut-list">
      {REVIEW_SHORTCUTS.map((s) => (
        <div key={s.label} className="shortcut-row">
          <dt>{s.label}</dt>
          <dd>
            <Kbd keys={s.keys} />
          </dd>
        </div>
      ))}
    </dl>
  )
}
