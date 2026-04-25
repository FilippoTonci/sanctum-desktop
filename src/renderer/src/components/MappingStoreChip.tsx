import { useState, type ReactElement } from 'react'
import type { MappingClient } from '../api/mapping'
import { ApiError } from '../api/types'
import { useReviewStore } from '../review/store'
import { UnlockModal } from './UnlockModal'

interface MappingStoreChipProps {
  /** API client; null means standalone-browser fake mode (chip is hidden). */
  readonly client: MappingClient | null
}

/**
 * Title-bar indicator + control for the encrypted pseudonymize mapping
 * store. Reflects ``mappingStoreUnlocked`` from /health and lets the
 * user unlock (passphrase modal) or lock (one click) without leaving
 * the review surface. The state gates the pseudonymize operator option
 * in the tooltip + commit panel — see `OperatorPickerOption` and
 * `CommitPanel`.
 */
export function MappingStoreChip({ client }: MappingStoreChipProps): ReactElement | null {
  const unlocked = useReviewStore((s) => s.mappingStoreUnlocked)
  const setUnlocked = useReviewStore((s) => s.setMappingStoreUnlocked)
  const setLastSyncError = useReviewStore((s) => s.setLastSyncError)
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [locking, setLocking] = useState(false)

  if (client === null) return null

  const handleLock = (): void => {
    setLocking(true)
    void (async () => {
      try {
        const response = await client.lock()
        setUnlocked(response.unlocked)
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err)
        setLastSyncError(`mapping lock: ${message}`)
      } finally {
        setLocking(false)
      }
    })()
  }

  return (
    <>
      <div
        className={`mapping-chip mapping-chip-${unlocked === true ? 'unlocked' : 'locked'}`}
        data-testid="mapping-chip"
      >
        <span className="mapping-chip-icon" aria-hidden="true">
          {unlocked === true ? '🔓' : '🔒'}
        </span>
        <span className="mapping-chip-label">
          Mapping store: {unlocked === true ? 'unlocked' : 'locked'}
        </span>
        {unlocked === true ? (
          <button
            type="button"
            className="mapping-chip-action"
            onClick={handleLock}
            disabled={locking}
          >
            {locking ? 'Locking…' : 'Lock'}
          </button>
        ) : (
          <button
            type="button"
            className="mapping-chip-action"
            onClick={() => {
              setUnlockOpen(true)
            }}
          >
            Unlock…
          </button>
        )}
      </div>
      {unlockOpen ? (
        <UnlockModal
          client={client}
          onClose={() => {
            setUnlockOpen(false)
          }}
        />
      ) : null}
    </>
  )
}
