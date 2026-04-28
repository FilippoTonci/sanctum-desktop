import { useEffect, useState, type ReactElement } from 'react'
import type { SessionsClient } from '../api/sessions'
import { ApiError, type ReviewSessionIndexEntry } from '../api/types'

interface RecentSessionsProps {
  /** API client for fetching the list. `null` = no backend, render empty state. */
  readonly client: SessionsClient | null
  /**
   * Called when the user clicks a row to resume a session. Only fires
   * for `open` sessions; terminal rows (committed / abandoned) render
   * disabled because the backend has shed their input bytes — there's
   * nothing for the desktop to load. The list still shows them so the
   * user keeps an audit trail of past reviews.
   */
  readonly onResume?: (sessionId: string) => void
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; sessions: readonly ReviewSessionIndexEntry[] }
  | { kind: 'error'; message: string }

export function RecentSessions({ client, onResume }: RecentSessionsProps): ReactElement | null {
  const [state, setState] = useState<LoadState>({ kind: 'idle' })

  useEffect(() => {
    if (client === null) {
      setState({ kind: 'idle' })
      return undefined
    }
    const ctrl = new AbortController()
    setState({ kind: 'loading' })
    void (async () => {
      try {
        const body = await client.listSessions(ctrl.signal)
        if (!ctrl.signal.aborted) setState({ kind: 'ready', sessions: body.sessions })
      } catch (err) {
        if (ctrl.signal.aborted) return
        const message =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err)
        setState({ kind: 'error', message })
      }
    })()
    return () => {
      ctrl.abort()
    }
  }, [client])

  // Standalone-browser mode (no client) → omit the panel entirely so the
  // drop zone stands alone. This is the "no backend, no recent sessions"
  // path; an explicit empty state would be misleading.
  if (client === null) return null

  return (
    <section className="recent-sessions" aria-label="Recent review sessions">
      <header className="recent-sessions-header">
        <h2>Recent sessions</h2>
        {state.kind === 'ready' ? (
          <span className="recent-sessions-count">
            {state.sessions.length === 0
              ? 'None yet'
              : `${String(state.sessions.length)} session${state.sessions.length === 1 ? '' : 's'}`}
          </span>
        ) : null}
      </header>

      {state.kind === 'loading' ? (
        <p className="recent-sessions-status" role="status">
          Loading…
        </p>
      ) : null}

      {state.kind === 'error' ? (
        <p className="recent-sessions-status recent-sessions-error" role="alert">
          Could not load sessions: {state.message}
        </p>
      ) : null}

      {state.kind === 'ready' && state.sessions.length === 0 ? (
        <p className="recent-sessions-empty">
          No reviews yet. Drop a .docx below to start your first one.
        </p>
      ) : null}

      {state.kind === 'ready' && state.sessions.length > 0 ? (
        <ul className="recent-sessions-list">
          {state.sessions.map((s) => {
            const resumable = s.status === 'open'
            const tooltip = resumable
              ? `${s.source_path} · ${s.id}`
              : `${s.source_path} · ${s.id} — ${s.status}; input bytes shed at terminal status`
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`recent-sessions-item recent-sessions-item-${s.status}`}
                  onClick={resumable ? () => onResume?.(s.id) : undefined}
                  disabled={!resumable}
                  aria-disabled={!resumable}
                  title={tooltip}
                >
                  <div className="recent-sessions-item-row">
                    <span className="recent-sessions-item-name">{filename(s.source_path)}</span>
                    <span
                      className={`recent-sessions-item-status recent-sessions-item-status-${s.status}`}
                    >
                      {s.status}
                    </span>
                  </div>
                  <div className="recent-sessions-item-meta">
                    <span>{formatRelative(s.created_at)}</span>
                    <span className="recent-sessions-item-counts">
                      {s.pending_count > 0 ? (
                        <span className="recent-sessions-item-pending">
                          {String(s.pending_count)} pending
                        </span>
                      ) : null}
                      {s.accepted_count > 0 ? (
                        <span className="recent-sessions-item-accepted">
                          {String(s.accepted_count)} accepted
                        </span>
                      ) : null}
                      {s.rejected_count > 0 ? (
                        <span className="recent-sessions-item-rejected">
                          {String(s.rejected_count)} rejected
                        </span>
                      ) : null}
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}

function filename(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] ?? path
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const now = Date.now()
  const diffMs = now - d.getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${String(minutes)} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${String(hours)} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${String(days)} d ago`
  return d.toLocaleDateString()
}
