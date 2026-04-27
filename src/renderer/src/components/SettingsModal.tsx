import { useEffect, useState, type ReactElement } from 'react'
import { OPERATOR_NAMES, type OperatorName } from '../review/types'
import type { AppSettings, NerBackend } from '../sanctum'

interface SettingsModalProps {
  readonly onClose: () => void
}

/**
 * Settings dialog backed by `window.sanctum.{getSettings,updateSettings}`.
 * Save persists via the main-process JSON store and triggers a sidecar
 * respawn — the renderer's existing splash UX handles the transient
 * 'starting' / 'waiting-for-health' status states for free.
 *
 * Three knobs in scope for slice 7:
 *
 * - NER backend  (Standard / Professional)        SANCTUM_NLP__NER_BACKEND
 * - Score threshold (0–1)                          SANCTUM_ANALYZER__DEFAULT_SCORE_THRESHOLD
 * - Default operator                               SANCTUM_ANONYMIZER__DEFAULT_OPERATOR
 *
 * Future slices can grow this surface; the IPC contract is
 * additive-friendly because settingsToEnv only emits the variables it
 * knows about.
 */
export function SettingsModal({ onClose }: SettingsModalProps): ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.sanctum?.getSettings().then((current) => {
      setSettings(current)
      setDraft(current)
    })
  }, [])

  if (draft === null) {
    return (
      <div className="commit-panel-backdrop" data-testid="settings-modal">
        <div className="commit-panel">
          <p>Loading settings…</p>
        </div>
      </div>
    )
  }

  const dirty = settings !== null && JSON.stringify(settings) !== JSON.stringify(draft)

  const handleSave = (): void => {
    if (!dirty) return
    setSubmitting(true)
    setError(null)
    void (async () => {
      try {
        const next = await window.sanctum?.updateSettings(draft)
        if (next === null || next === undefined) {
          throw new Error('Settings unavailable in this build')
        }
        setSettings(next)
        onClose()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        setSubmitting(false)
      }
    })()
  }

  return (
    <div className="commit-panel-backdrop" data-testid="settings-modal">
      <div
        className="commit-panel settings-modal"
        role="dialog"
        aria-labelledby="settings-modal-title"
      >
        <header>
          <h2 id="settings-modal-title">Settings</h2>
        </header>
        <p className="unlock-modal-detail">
          Saving applies the new configuration to a fresh Sanctum sidecar process. The active review
          session is preserved server-side; the splash will reappear briefly while the backend
          reloads.
        </p>

        <label className="settings-modal-field">
          NLP tier
          <select
            value={draft.nerBackend}
            onChange={(e) => {
              setDraft({ ...draft, nerBackend: e.currentTarget.value as NerBackend })
            }}
          >
            <option value="spacy">Standard (spaCy en_core_web_sm, ~15 MB)</option>
            <option value="gliner">Professional (GLiNER medium, ~1.4 GB)</option>
          </select>
          <span className="settings-modal-hint">
            Professional improves recall on the legal/consulting fixture set; first run downloads
            the model from HuggingFace.
          </span>
        </label>

        <label className="settings-modal-field">
          Score threshold
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={draft.scoreThreshold}
            onChange={(e) => {
              setDraft({ ...draft, scoreThreshold: Number.parseFloat(e.currentTarget.value) })
            }}
          />
          <span className="settings-modal-hint">
            Detections below this confidence are dropped before the review surface sees them.
            Default 0.35.
          </span>
        </label>

        <label className="settings-modal-field">
          Default operator
          <select
            value={draft.defaultOperator}
            onChange={(e) => {
              setDraft({ ...draft, defaultOperator: e.currentTarget.value })
            }}
          >
            {OPERATOR_NAMES.map((op: OperatorName) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
          <span className="settings-modal-hint">
            Used for new sessions whose CLI / API caller didn&rsquo;t pick one explicitly.
          </span>
        </label>

        {error !== null ? (
          <p className="commit-panel-blocker" role="alert">
            <strong>Could not save.</strong> {error}
          </p>
        ) : null}

        <div className="commit-panel-actions">
          <button
            type="button"
            className="commit-panel-cancel"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="commit-panel-submit"
            disabled={!dirty || submitting}
            onClick={handleSave}
          >
            {submitting ? 'Saving…' : 'Save & restart sidecar'}
          </button>
        </div>
      </div>
    </div>
  )
}
