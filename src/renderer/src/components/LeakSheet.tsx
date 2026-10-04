import { useEffect, useRef, type ReactElement } from 'react'
import type { LeakFix } from '../review/leaks'

export const UNREACHABLE_TEXT =
  "Appears where Sanctum can't redact it (for example a footnote, text box or chart). Edit the original document, then open it again."

interface LeakSheetProps {
  readonly fixes: readonly LeakFix[]
  /** True while the findings are being added and the save retried. */
  readonly busy: boolean
  /** An add failed part-way; shown inline, and the primary becomes "Try again". */
  readonly error: string | null
  readonly onRedact: () => void
  readonly onBack: () => void
}

const places = (n: number): string => `${String(n)} more place${n === 1 ? '' : 's'}`
const kept = (n: number): string => `${String(n)} place${n === 1 ? '' : 's'} you chose to keep`

/**
 * Shown when the engine refuses a save because text the reviewer redacted
 * somewhere still appears elsewhere in the copy (HTTP 422 from commit).
 * Same structure and classes as `ConfirmDialog`.
 */
export function LeakSheet({ fixes, busy, error, onRedact, onBack }: LeakSheetProps): ReactElement {
  const primaryRef = useRef<HTMLButtonElement | null>(null)
  const backRef = useRef<HTMLButtonElement | null>(null)
  const canRedact = fixes.some((f) => f.reachable)
  const overridesKeep = fixes.some((f) => f.keptPlaces > 0)
  const primaryLabel = busy
    ? 'Redacting…'
    : error !== null
      ? 'Try again'
      : overridesKeep
        ? 'Redact these too, including kept places'
        : 'Redact these too'

  useEffect(() => {
    ;(canRedact ? primaryRef.current : backRef.current)?.focus()
  }, [canRedact])

  return (
    <div
      className="overlay"
      role="presentation"
      data-testid="leak-sheet"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) {
          e.preventDefault()
          onBack()
        }
      }}
    >
      <div
        className="sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leak-title"
        aria-describedby="leak-body"
      >
        <h2 id="leak-title" className="sheet-title">
          Some redacted text is still in the document
        </h2>
        <p id="leak-body" className="sheet-text">
          You redacted these values, but they still appear elsewhere, so the copy was not saved.
        </p>
        <ul className="leak-list">
          {fixes.map((fix, i) => (
            <li key={`${fix.value}-${String(i)}`} className="leak-row">
              <span>
                <strong className="mono">{fix.value}</strong> — {places(fix.occurrences)}
                {fix.keptPlaces > 0 ? `, including ${kept(fix.keptPlaces)}` : null}
              </span>
              {fix.reachable ? null : <span className="leak-row-note">{UNREACHABLE_TEXT}</span>}
            </li>
          ))}
        </ul>
        {overridesKeep ? (
          <p className="field-hint">
            Redacting a place you chose to keep replaces that decision. Undo will not bring it back.
          </p>
        ) : null}
        {error !== null ? (
          <div className="notice notice-warn leak-error" role="alert">
            <p>{error}</p>
          </div>
        ) : null}
        <div className="sheet-actions">
          <span className="sheet-actions-spacer" />
          <button
            ref={backRef}
            type="button"
            className="btn btn-secondary"
            onClick={onBack}
            disabled={busy}
          >
            Back to review
          </button>
          {canRedact ? (
            <button
              ref={primaryRef}
              type="button"
              className="btn btn-primary"
              onClick={onRedact}
              disabled={busy}
            >
              {primaryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
