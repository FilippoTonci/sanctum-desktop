import type { ReactElement } from 'react'
import { countDetections } from '../review/bulk'
import { useReviewStore } from '../review/store'
import { formatBytes } from './DocxView'
import { Icon, Kbd } from './Icon'

interface ReviewToolbarProps {
  readonly fileName: string
  readonly fileSize: number
  readonly onClose: () => void
  readonly onUndo: () => void
}

/**
 * Top bar of the review canvas: which document, how far along the
 * review is, and the one primary action — save the redacted copy.
 */
export function ReviewToolbar({
  fileName,
  fileSize,
  onClose,
  onUndo,
}: ReviewToolbarProps): ReactElement {
  const detections = useReviewStore((s) => s.detections)
  const canUndo = useReviewStore((s) => s.undoStack.length > 0)
  const openCommit = useReviewStore((s) => s.openCommitPanel)
  const counts = countDetections(detections)
  const done = counts.total > 0 && counts.pending === 0
  const pct = (n: number): string =>
    counts.total === 0 ? '0%' : `${((n / counts.total) * 100).toFixed(2)}%`

  return (
    <header className="toolbar">
      <div className="toolbar-doc">
        <Icon name="doc" className="toolbar-doc-icon" />
        <span className="toolbar-doc-name" title={fileName}>
          {fileName}
        </span>
        <span className="toolbar-doc-size">{formatBytes(fileSize)}</span>
      </div>

      <div
        className="progress"
        role="progressbar"
        aria-label="Review progress"
        aria-valuemin={0}
        aria-valuemax={counts.total}
        aria-valuenow={counts.reviewed}
        aria-valuetext={`${String(counts.reviewed)} of ${String(counts.total)} reviewed`}
      >
        <div className="progress-track" aria-hidden="true">
          <span
            className="progress-fill progress-accepted"
            style={{ width: pct(counts.accepted) }}
          />
          <span
            className="progress-fill progress-rejected"
            style={{ width: pct(counts.rejected) }}
          />
        </div>
        <span className="progress-label">
          {counts.total === 0 ? (
            'No detections'
          ) : done ? (
            <>
              <Icon name="check" size={12} /> All {String(counts.total)} reviewed
            </>
          ) : (
            <>
              <span className="mono">{String(counts.reviewed)}</span> of{' '}
              <span className="mono">{String(counts.total)}</span> reviewed
            </>
          )}
        </span>
      </div>

      <div className="toolbar-actions">
        <button
          type="button"
          className="btn btn-icon btn-ghost"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo last decision (⌘Z)"
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          className="btn btn-icon btn-ghost"
          onClick={onClose}
          aria-label="Close document"
          title="Close document"
        >
          <Icon name="close" />
        </button>
        <button
          type="button"
          className={`btn ${done ? 'btn-primary' : 'btn-secondary'}`}
          onClick={openCommit}
          title={
            done
              ? 'Save a redacted copy (⌘S)'
              : `${String(counts.pending)} still to review before saving`
          }
        >
          Save redacted copy
          <Kbd keys={['⌘', 'S']} />
        </button>
      </div>
    </header>
  )
}
