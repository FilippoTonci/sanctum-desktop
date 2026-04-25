import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { MappingClient } from '../api/mapping'
import { ApiError } from '../api/types'
import { useReviewStore } from '../review/store'

interface UnlockModalProps {
  readonly client: MappingClient
  readonly onClose: () => void
}

/**
 * Passphrase prompt for unlocking the encrypted mapping store.
 *
 * The store path is the renderer's well-known per-user location
 * (`window.sanctum.getMappingStorePath()` — defaults to
 * `~/.sanctum/mapping-store.bin`). WS5-7 (settings) will let the user
 * override the path; until then the modal asks only for the passphrase.
 *
 * The passphrase lives in this component's state for the lifetime of
 * the modal — it never enters the Zustand store, never gets logged,
 * never appears in the React DevTools history because the component
 * unmounts on success/cancel and the password input is type='password'.
 */
export function UnlockModal({ client, onClose }: UnlockModalProps): ReactElement {
  const setUnlocked = useReviewStore((s) => s.setMappingStoreUnlocked)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [storePath, setStorePath] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.sanctum?.getMappingStorePath().then(setStorePath)
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (event: React.SyntheticEvent): void => {
    event.preventDefault()
    if (storePath === null || passphrase === '') return
    setSubmitting(true)
    setError(null)
    void (async () => {
      try {
        const response = await client.unlock({ store_path: storePath, passphrase })
        setUnlocked(response.unlocked)
        onClose()
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err)
        setError(message)
      } finally {
        setSubmitting(false)
      }
    })()
  }

  return (
    <div className="commit-panel-backdrop" data-testid="unlock-modal">
      <form
        className="commit-panel unlock-modal"
        onSubmit={handleSubmit}
        aria-labelledby="unlock-modal-title"
      >
        <header>
          <h2 id="unlock-modal-title">Unlock mapping store</h2>
        </header>
        <p className="unlock-modal-detail">
          Required for the <code>pseudonymize</code> operator. The passphrase derives the encryption
          key for <code className="unlock-modal-path">{storePath ?? 'loading…'}</code>; if the file
          doesn&rsquo;t exist yet it will be created with this passphrase.
        </p>

        <label className="unlock-modal-field">
          Passphrase
          <input
            ref={inputRef}
            type="password"
            autoComplete="off"
            value={passphrase}
            onChange={(e) => {
              setPassphrase(e.currentTarget.value)
            }}
            disabled={submitting}
          />
        </label>

        {error !== null ? (
          <p className="commit-panel-blocker" role="alert">
            <strong>Could not unlock.</strong> {error}
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
            type="submit"
            className="commit-panel-submit"
            disabled={submitting || passphrase === '' || storePath === null}
          >
            {submitting ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      </form>
    </div>
  )
}
