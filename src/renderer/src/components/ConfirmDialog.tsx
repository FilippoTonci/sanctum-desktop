import { useEffect, useRef, type ReactElement } from 'react'

interface ConfirmDialogProps {
  readonly title: string
  readonly body: string
  readonly confirmLabel: string
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/** Small destructive-confirmation dialog. Enter confirms, Esc cancels. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactElement {
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    confirmRef.current?.focus()
  }, [])
  return (
    <div
      className="overlay"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
    >
      <div
        className="sheet sheet-sm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
      >
        <h2 id="confirm-title" className="sheet-title">
          {title}
        </h2>
        <p id="confirm-body" className="sheet-text">
          {body}
        </p>
        <div className="sheet-actions">
          <span className="sheet-actions-spacer" />
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button ref={confirmRef} type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
