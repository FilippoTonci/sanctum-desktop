import { useMemo, useState, type ReactElement } from 'react'
import { useReviewStore } from '../review/store'
import { OPERATOR_NAMES, type OperatorName } from '../review/types'

const ATTESTATION =
  'I have reviewed every PII detection in this document and confirm the verdicts above.'

export function CommitPanel(): ReactElement | null {
  const open = useReviewStore((s) => s.commitPanelOpen)
  const close = useReviewStore((s) => s.closeCommitPanel)
  const detections = useReviewStore((s) => s.detections)
  const buildPayload = useReviewStore((s) => s.buildCommitPayload)
  const defaultOperator = useReviewStore((s) => s.defaultOperator)
  const setDefaultOperator = useReviewStore((s) => s.setDefaultOperator)

  const [attested, setAttested] = useState(false)

  const counts = useMemo(() => aggregate(detections), [detections])

  if (!open) return null

  const pendingCount = counts.pending
  const allReviewed = pendingCount === 0
  const canSubmit = attested && allReviewed && detections.length > 0

  const handleSubmit = (): void => {
    if (!canSubmit) return
    const payload = buildPayload(ATTESTATION)
    // In fake / standalone mode we cannot POST anywhere; surface the
    // shape so the WS5 wire-up has a clear handoff. This console
    // statement is the only one in the renderer; deliberately not
    // routed through a logger because it is a dev-mode peek.

    console.info('[sanctum] commit payload:', payload)
    setAttested(false)
    close()
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
          <button type="button" className="commit-panel-cancel" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="commit-panel-submit"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Commit
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
