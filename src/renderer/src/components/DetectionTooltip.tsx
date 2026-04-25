import { autoUpdate, offset, shift, useFloating } from '@floating-ui/react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { findSegmentRange } from '../review/segments'
import { useReviewStore } from '../review/store'
import { OPERATOR_NAMES, type Detection, type OperatorName } from '../review/types'

interface DetectionTooltipProps {
  /** The DocxView body element; tooltip positions against ranges inside it. */
  readonly anchorRoot: HTMLElement | null
}

export function DetectionTooltip({ anchorRoot }: DetectionTooltipProps): ReactElement | null {
  const focusedId = useReviewStore((s) => s.focusedId)
  const detections = useReviewStore((s) => s.detections)
  const setStatus = useReviewStore((s) => s.setStatus)
  const setOperator = useReviewStore((s) => s.setOperator)
  const setCustomReplacement = useReviewStore((s) => s.setCustomReplacement)
  const defaultOperator = useReviewStore((s) => s.defaultOperator)
  const editingReplacementId = useReviewStore((s) => s.editingReplacementId)
  const startEditingReplacement = useReviewStore((s) => s.startEditingReplacement)

  const [draftReplacement, setDraftReplacement] = useState('')
  const editInputRef = useRef<HTMLInputElement | null>(null)

  const focused = useMemo(
    () => detections.find((d) => d.id === focusedId) ?? null,
    [detections, focusedId],
  )

  const editing = focused !== null && editingReplacementId === focused.id

  // Initialize the draft when the editor opens, and move keyboard focus
  // into it so 'e' on the keyboard map lands on the input directly.
  useEffect(() => {
    if (editing) {
      setDraftReplacement(focused.customReplacement ?? '')
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editing, focused?.customReplacement])

  const virtualReference = useMemo(
    () => buildVirtualReference(anchorRoot, focused),
    [anchorRoot, focused],
  )

  const { refs, floatingStyles, update } = useFloating({
    placement: 'top',
    middleware: [offset(10), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  useEffect(() => {
    refs.setReference(virtualReference)
  }, [refs, virtualReference])

  useEffect(() => {
    if (virtualReference !== null) update()
  }, [update, virtualReference, focused, editing])

  if (focused === null || virtualReference === null) return null

  const effectiveOperator = focused.operator ?? defaultOperator

  return (
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className="detection-tooltip"
      role="dialog"
      aria-label={`Detection: ${focused.entityType}`}
      data-testid="detection-tooltip"
    >
      <div className="detection-tooltip-header">
        <span className="detection-tooltip-entity">{focused.entityType}</span>
        <span className="detection-tooltip-status">{focused.status}</span>
      </div>
      <p className="detection-tooltip-text">"{focused.text}"</p>

      <label className="detection-tooltip-operator">
        Operator
        <select
          value={effectiveOperator}
          onChange={(e) => {
            setOperator(focused.id, e.currentTarget.value as OperatorName)
          }}
        >
          {OPERATOR_NAMES.map((op) => (
            <option key={op} value={op}>
              {op}
              {op === defaultOperator && focused.operator === undefined ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>

      {editing ? (
        <div className="detection-tooltip-edit">
          <input
            ref={editInputRef}
            type="text"
            value={draftReplacement}
            placeholder="Custom replacement…"
            onChange={(e) => {
              setDraftReplacement(e.currentTarget.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                setCustomReplacement(
                  focused.id,
                  draftReplacement.length === 0 ? null : draftReplacement,
                )
                startEditingReplacement(null)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                startEditingReplacement(null)
              }
            }}
          />
          <button
            type="button"
            className="detection-tooltip-edit-cancel"
            onClick={() => {
              startEditingReplacement(null)
            }}
          >
            Cancel
          </button>
        </div>
      ) : focused.customReplacement !== undefined ? (
        <p className="detection-tooltip-replacement">
          Replace with: <code>{focused.customReplacement}</code>
          <button
            type="button"
            className="detection-tooltip-edit-start"
            onClick={() => {
              startEditingReplacement(focused.id)
            }}
          >
            Edit
          </button>
        </p>
      ) : (
        <button
          type="button"
          className="detection-tooltip-edit-start"
          onClick={() => {
            startEditingReplacement(focused.id)
          }}
        >
          Edit replacement
        </button>
      )}

      <div className="detection-tooltip-actions">
        <button
          type="button"
          className="detection-tooltip-accept"
          onClick={() => {
            setStatus(focused.id, 'accepted')
          }}
        >
          Accept
        </button>
        <button
          type="button"
          className="detection-tooltip-reject"
          onClick={() => {
            setStatus(focused.id, 'rejected')
          }}
        >
          Reject
        </button>
      </div>
    </div>
  )
}

interface VirtualElement {
  getBoundingClientRect: () => DOMRect
}

function buildVirtualReference(
  root: HTMLElement | null,
  detection: Detection | null,
): VirtualElement | null {
  if (root === null || detection === null) return null
  const range = findSegmentRange(root, {
    segmentId: detection.segmentId,
    start: detection.start,
    end: detection.end,
  })
  if (range === null) return null
  return {
    getBoundingClientRect: () => range.getBoundingClientRect(),
  }
}
