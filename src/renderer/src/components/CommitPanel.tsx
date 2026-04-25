import { useMemo, useState, type ReactElement } from 'react'
import type { SessionsClient } from '../api/sessions'
import { ApiError } from '../api/types'
import { useReviewStore } from '../review/store'
import { OPERATOR_NAMES, type OperatorName } from '../review/types'

const ATTESTATION =
  'I have reviewed every PII detection in this document and confirm the verdicts above.'

interface CommitPanelProps {
  /**
   * API client for the live POST. `null` triggers fake-mode behavior:
   * the panel logs the would-be payload to the console and closes,
   * matching WS4 ergonomics until a real backend is wired.
   */
  readonly client: SessionsClient | null
  /** Original document filename, used to seed the save-dialog default. */
  readonly sourceFileName: string | null
  /** Called after the user dismisses a successful commit's success state. */
  readonly onDone: () => void
}

type SubmitState = { kind: 'form' } | { kind: 'submitting' } | { kind: 'error'; message: string }

export function CommitPanel({
  client,
  sourceFileName,
  onDone,
}: CommitPanelProps): ReactElement | null {
  const open = useReviewStore((s) => s.commitPanelOpen)
  const close = useReviewStore((s) => s.closeCommitPanel)
  const detections = useReviewStore((s) => s.detections)
  const buildPayload = useReviewStore((s) => s.buildCommitPayload)
  const defaultOperator = useReviewStore((s) => s.defaultOperator)
  const setDefaultOperator = useReviewStore((s) => s.setDefaultOperator)
  const sessionId = useReviewStore((s) => s.sessionId)
  const commitResult = useReviewStore((s) => s.commitResult)
  const setCommitResult = useReviewStore((s) => s.setCommitResult)

  const [attested, setAttested] = useState(false)
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'form' })

  const counts = useMemo(() => aggregate(detections), [detections])

  if (!open && commitResult === null) return null
  // After a successful commit we keep the panel open even if `open` is
  // somehow toggled off — the success state is the user's only
  // confirmation the file landed.

  const pendingCount = counts.pending
  const allReviewed = pendingCount === 0
  const canSubmit =
    attested && allReviewed && detections.length > 0 && submitState.kind !== 'submitting'

  const handleSubmit = (): void => {
    if (!canSubmit) return

    if (client === null || sessionId === null) {
      // Fake mode: keep the WS4 console.info ergonomic so the standalone
      // browser preview stays exercisable.
      const payload = buildPayload(ATTESTATION)

      console.info('[sanctum] commit payload (fake mode):', payload)
      setAttested(false)
      close()
      return
    }

    const defaultName = suggestedOutputName(sourceFileName)
    void (async () => {
      const dialog = await window.sanctum?.showSaveDialog({
        defaultPath: defaultName,
        title: 'Save anonymized document',
      })
      if (dialog === undefined) {
        setSubmitState({
          kind: 'error',
          message: 'Save dialog unavailable in this build',
        })
        return
      }
      if (dialog.canceled || dialog.filePath === null) return

      setSubmitState({ kind: 'submitting' })
      try {
        const response = await client.commitSession(sessionId, {
          output_path: dialog.filePath,
          attested: true,
        })
        setCommitResult({
          outputPath: response.output_path,
          committedAt: response.committed_at,
        })
        setSubmitState({ kind: 'form' })
        setAttested(false)
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err)
        setSubmitState({ kind: 'error', message })
      }
    })()
  }

  const handleReveal = (): void => {
    if (commitResult === null) return
    void window.sanctum?.revealInFolder(commitResult.outputPath)
  }

  const handleDone = (): void => {
    onDone()
  }

  if (commitResult !== null) {
    return (
      <div className="commit-panel-backdrop" data-testid="commit-panel">
        <div role="dialog" aria-labelledby="commit-panel-title" className="commit-panel">
          <header>
            <h2 id="commit-panel-title">Anonymized document saved</h2>
          </header>
          <p className="commit-panel-success-text">Wrote the anonymized output to:</p>
          <code className="commit-panel-success-path">{commitResult.outputPath}</code>
          <p className="commit-panel-success-detail">
            Committed at {new Date(commitResult.committedAt).toLocaleString()}.
          </p>
          <div className="commit-panel-actions">
            {window.sanctum?.revealInFolder !== undefined ? (
              <button type="button" className="commit-panel-cancel" onClick={handleReveal}>
                Reveal in folder
              </button>
            ) : null}
            <button type="button" className="commit-panel-submit" onClick={handleDone}>
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="commit-panel-backdrop" data-testid="commit-panel">
      <div role="dialog" aria-labelledby="commit-panel-title" className="commit-panel">
        <header>
          <h2 id="commit-panel-title">Commit anonymization</h2>
        </header>

        <dl className="commit-panel-summary">
          <div>
            <dt>Total detections</dt>
            <dd>{String(detections.length)}</dd>
          </div>
          <div>
            <dt>Accepted</dt>
            <dd>{String(counts.accepted)}</dd>
          </div>
          <div>
            <dt>Rejected</dt>
            <dd>{String(counts.rejected)}</dd>
          </div>
          <div>
            <dt>Pending</dt>
            <dd className={pendingCount > 0 ? 'commit-panel-warn' : ''}>{String(pendingCount)}</dd>
          </div>
        </dl>

        <label className="commit-panel-default-operator">
          Default operator
          <select
            value={defaultOperator}
            onChange={(e) => {
              setDefaultOperator(e.currentTarget.value as OperatorName)
            }}
          >
            {OPERATOR_NAMES.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        </label>

        {pendingCount > 0 ? (
          <p className="commit-panel-blocker" role="alert">
            {String(pendingCount)} detection{pendingCount === 1 ? '' : 's'} still need a verdict.
          </p>
        ) : null}

        {submitState.kind === 'error' ? (
          <p className="commit-panel-blocker" role="alert">
            <strong>Commit failed.</strong> {submitState.message}
          </p>
        ) : null}

        <label className="commit-panel-attest">
          <input
            type="checkbox"
            checked={attested}
            onChange={(e) => {
              setAttested(e.currentTarget.checked)
            }}
            disabled={!allReviewed}
          />
          <span>{ATTESTATION}</span>
        </label>

        <div className="commit-panel-actions">
          <button
            type="button"
            className="commit-panel-cancel"
            onClick={close}
            disabled={submitState.kind === 'submitting'}
          >
            Cancel
          </button>
          <button
            type="button"
            className="commit-panel-submit"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitState.kind === 'submitting' ? 'Committing…' : 'Commit'}
          </button>
        </div>
      </div>
    </div>
  )
}

function aggregate(detections: readonly { status: string }[]): {
  pending: number
  accepted: number
  rejected: number
} {
  const out = { pending: 0, accepted: 0, rejected: 0 }
  for (const d of detections) {
    if (d.status === 'pending') out.pending++
    else if (d.status === 'accepted') out.accepted++
    else if (d.status === 'rejected') out.rejected++
  }
  return out
}

function suggestedOutputName(sourceFileName: string | null): string | undefined {
  if (sourceFileName === null) return undefined
  const dot = sourceFileName.lastIndexOf('.')
  if (dot === -1) return `${sourceFileName}_anonymized`
  return `${sourceFileName.slice(0, dot)}_anonymized${sourceFileName.slice(dot)}`
}
