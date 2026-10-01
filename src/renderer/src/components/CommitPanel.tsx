import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { SessionsClient } from '../api/sessions'
import { countDetections } from '../review/bulk'
import { useReviewStore } from '../review/store'
import { Icon, Kbd } from './Icon'
import { TypedError } from './TypedError'

const ATTESTATION = 'I have reviewed every detection in this document and confirm these decisions.'

interface CommitPanelProps {
  /**
   * API client for the live POST. `null` triggers fake-mode behavior:
   * the panel logs the would-be payload to the console and closes.
   */
  readonly client: SessionsClient | null
  /** Original document filename, used to seed the save-dialog default. */
  readonly sourceFileName: string | null
  /** Absolute path of the original, when known; seeds the dialog's folder. */
  readonly sourcePath: string | null
  /** Suffix from Settings → Saving (e.g. "_anonymized"). */
  readonly outputSuffix: string
  /** Settings → Saving: open the dialog in the original's folder. */
  readonly saveNextToOriginal: boolean
  /** Called after the user dismisses a successful save. */
  readonly onDone: () => void
  /** Called from the success state's "Open another document". */
  readonly onOpenAnother: () => void
}

type SubmitState = { kind: 'form' } | { kind: 'submitting' } | { kind: 'error'; error: unknown }

export function CommitPanel({
  client,
  sourceFileName,
  sourcePath,
  outputSuffix,
  saveNextToOriginal,
  onDone,
  onOpenAnother,
}: CommitPanelProps): ReactElement | null {
  const open = useReviewStore((s) => s.commitPanelOpen)
  const close = useReviewStore((s) => s.closeCommitPanel)
  const detections = useReviewStore((s) => s.detections)
  const buildPayload = useReviewStore((s) => s.buildCommitPayload)
  const sessionId = useReviewStore((s) => s.sessionId)
  const commitResult = useReviewStore((s) => s.commitResult)
  const setCommitResult = useReviewStore((s) => s.setCommitResult)
  const focusNextPending = useReviewStore((s) => s.focusNextPending)
  const setFocused = useReviewStore((s) => s.setFocused)

  const [attested, setAttested] = useState(false)
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'form' })
  const dialogRef = useRef<HTMLDivElement | null>(null)

  const counts = useMemo(() => countDetections(detections), [detections])
  const visible = open || commitResult !== null

  // Move focus into the sheet when it opens so Space / Enter / Esc land here.
  useEffect(() => {
    if (!visible) return
    const el = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')
    el?.focus()
  }, [visible, commitResult])

  if (!visible) return null

  const pendingCount = counts.pending
  const allReviewed = pendingCount === 0
  const canSubmit =
    attested && allReviewed && detections.length > 0 && submitState.kind !== 'submitting'
  const outputName = suggestedOutputName(sourceFileName, outputSuffix)

  const handleSubmit = (): void => {
    if (!canSubmit) return

    if (client === null || sessionId === null) {
      // Fake mode: keep the console.info ergonomic so the standalone
      // browser preview stays exercisable.
      const payload = buildPayload(ATTESTATION)

      console.info('[sanctum] commit payload (fake mode):', payload)
      setAttested(false)
      close()
      return
    }

    const defaultPath = suggestedOutputPath(sourcePath, outputName, saveNextToOriginal)
    void (async () => {
      const dialog = await window.sanctum?.showSaveDialog({
        defaultPath,
        title: 'Save redacted copy',
      })
      if (dialog === undefined) {
        setSubmitState({
          kind: 'error',
          error: new Error('Save dialog unavailable in this build'),
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
        setSubmitState({ kind: 'error', error: err })
      }
    })()
  }

  const handleReviewRemaining = (): void => {
    close()
    const state = useReviewStore.getState()
    const current = state.detections.find((d) => d.id === state.focusedId)
    if (current?.status === 'pending') return
    const firstPending = state.detections.find((d) => d.status === 'pending')
    if (firstPending !== undefined && state.focusedId === null) setFocused(firstPending.id)
    else focusNextPending()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' && submitState.kind !== 'submitting') {
      e.preventDefault()
      if (commitResult !== null) onDone()
      else close()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && commitResult === null) {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (commitResult !== null) {
    return (
      <div className="overlay" data-testid="commit-panel" role="presentation" onKeyDown={onKeyDown}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="commit-panel-title"
          className="sheet"
        >
          <div className="sheet-success-mark" aria-hidden="true">
            <Icon name="check" size={18} />
          </div>
          <h2 id="commit-panel-title" className="sheet-title">
            Redacted copy saved
          </h2>
          <p className="sheet-text">
            {String(counts.accepted)} redaction{counts.accepted === 1 ? '' : 's'} written. The
            original document was not changed.
          </p>
          <code className="path-box">{commitResult.outputPath}</code>
          <p className="field-hint">Saved {new Date(commitResult.committedAt).toLocaleString()}</p>
          <div className="sheet-actions">
            {window.sanctum?.revealInFolder !== undefined ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  void window.sanctum?.revealInFolder(commitResult.outputPath)
                }}
              >
                Show in folder
              </button>
            ) : null}
            <span className="sheet-actions-spacer" />
            <button type="button" className="btn btn-secondary" onClick={onOpenAnother}>
              Open another…
            </button>
            <button type="button" className="btn btn-primary" data-autofocus onClick={onDone}>
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="overlay" data-testid="commit-panel" role="presentation" onKeyDown={onKeyDown}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="commit-panel-title"
        className="sheet"
      >
        <h2 id="commit-panel-title" className="sheet-title">
          Save redacted copy
        </h2>

        <dl className="summary">
          <div>
            <dt>Redacted</dt>
            <dd className="mono">{String(counts.accepted)}</dd>
          </div>
          <div>
            <dt>Kept</dt>
            <dd className="mono">{String(counts.rejected)}</dd>
          </div>
          <div className={pendingCount > 0 ? 'is-warn' : ''}>
            <dt>To review</dt>
            <dd className="mono">{String(pendingCount)}</dd>
          </div>
        </dl>

        {pendingCount > 0 ? (
          <div className="notice notice-warn" role="alert">
            <p>
              {String(pendingCount)} detection{pendingCount === 1 ? '' : 's'} still need
              {pendingCount === 1 ? 's' : ''} a decision before you can save.
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              data-autofocus
              onClick={handleReviewRemaining}
            >
              Review remaining
            </button>
          </div>
        ) : null}

        <div className="output-preview">
          <span className="field-label">File</span>
          <span className="mono output-name">{outputName ?? 'redacted copy'}</span>
          <span className="field-hint">
            {saveNextToOriginal && sourcePath !== null
              ? 'Next to the original. You confirm the location in the next step.'
              : 'You choose the location in the next step.'}
          </span>
        </div>

        {submitState.kind === 'error' ? (
          <TypedError
            error={submitState.error}
            onDismiss={() => {
              setSubmitState({ kind: 'form' })
            }}
          />
        ) : null}

        <label className={`attest${allReviewed ? '' : ' is-disabled'}`}>
          <input
            type="checkbox"
            checked={attested}
            data-autofocus={allReviewed ? true : undefined}
            onChange={(e) => {
              setAttested(e.currentTarget.checked)
            }}
            disabled={!allReviewed}
          />
          <span>{ATTESTATION}</span>
        </label>

        <div className="sheet-actions">
          <span className="field-hint">
            <Kbd keys={['⌘', '↵']} /> to save
          </span>
          <span className="sheet-actions-spacer" />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={close}
            disabled={submitState.kind === 'submitting'}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitState.kind === 'submitting' ? 'Saving…' : 'Save redacted copy…'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function suggestedOutputName(
  sourceFileName: string | null,
  suffix = '_anonymized',
): string | undefined {
  if (sourceFileName === null) return undefined
  const dot = sourceFileName.lastIndexOf('.')
  if (dot === -1) return `${sourceFileName}${suffix}`
  return `${sourceFileName.slice(0, dot)}${suffix}${sourceFileName.slice(dot)}`
}

/** Join the original's folder with the output name when asked to. */
export function suggestedOutputPath(
  sourcePath: string | null,
  outputName: string | undefined,
  nextToOriginal: boolean,
): string | undefined {
  if (outputName === undefined) return undefined
  if (!nextToOriginal || sourcePath === null || sourcePath === '') return outputName
  const cut = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\'))
  if (cut === -1) return outputName
  return `${sourcePath.slice(0, cut + 1)}${outputName}`
}
