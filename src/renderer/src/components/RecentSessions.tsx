import { useEffect, useId, useState, type ReactElement } from 'react'
import type { SessionsClient } from '../api/sessions'
import { ApiError, type ReviewSessionIndexEntry } from '../api/types'

/**
 * Hard cap on the rows we surface in the UI. Anything older than the
 * top N is purged from the manifest by `pruneOldSessions` below — the
 * user explicitly asked for a tidy panel without a scroll well, and
 * keeping stale rows around would also bloat the on-disk manifest.
 */
const MAX_VISIBLE_SESSIONS = 5

interface RecentSessionsProps {
  /** API client for fetching the list. `null` = no backend, render empty state. */
  readonly client: SessionsClient | null
  /**
   * Called when the user clicks a row to resume a session. Only fires
   * for `open` sessions; terminal rows (committed / abandoned) render
   * disabled because the backend has shed their input bytes — there's
   * nothing for the desktop to load. The list still shows them so the
   * user keeps an audit trail of past reviews (capped at five).
   */
  readonly onResume?: (sessionId: string) => void
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; sessions: readonly ReviewSessionIndexEntry[] }
  | { kind: 'error'; message: string }

/**
 * Sort sessions by `created_at` descending (newest first) and return
 * the top N. Pure, exported for unit-test reach. Stable when the
 * timestamps tie — falls back to the original index order so behaviour
 * is deterministic in tests that craft equal `created_at` values.
 */
export function pickRecent(
  sessions: readonly ReviewSessionIndexEntry[],
  limit: number = MAX_VISIBLE_SESSIONS,
): readonly ReviewSessionIndexEntry[] {
  const indexed = sessions.map((s, i) => ({ s, i }))
  indexed.sort((a, b) => {
    const ta = Date.parse(a.s.created_at)
    const tb = Date.parse(b.s.created_at)
    if (Number.isNaN(ta) && Number.isNaN(tb)) return a.i - b.i
    if (Number.isNaN(ta)) return 1
    if (Number.isNaN(tb)) return -1
    if (tb !== ta) return tb - ta
    return a.i - b.i
  })
  return indexed.slice(0, limit).map((x) => x.s)
}

/**
 * Sessions ranked older than the top N — i.e. the rows we drop from
 * the UI and should also purge from the backend manifest. Pure
 * counterpart to `pickRecent`; exported for tests.
 */
export function pickStale(
  sessions: readonly ReviewSessionIndexEntry[],
  limit: number = MAX_VISIBLE_SESSIONS,
): readonly ReviewSessionIndexEntry[] {
  const recent = new Set(pickRecent(sessions, limit).map((s) => s.id))
  return sessions.filter((s) => !recent.has(s.id))
}

/**
 * Fire DELETE /review-sessions/{id} for every stale row. Best-effort:
 * the panel's job is to render the truth on next load, so a failed
 * delete (network blip, terminal session that already shed state)
 * isn't surfaced — the row just won't disappear until next mount.
 *
 * The DELETE is idempotent on the sidecar side: terminal sessions
 * (committed / abandoned) accept the call as a no-op-style cleanup
 * and open sessions transition to abandoned. Either way, the row
 * stops appearing in subsequent /review-sessions responses.
 */
async function pruneOldSessions(
  client: SessionsClient,
  stale: readonly ReviewSessionIndexEntry[],
  signal: AbortSignal,
): Promise<void> {
  if (stale.length === 0) return
  await Promise.allSettled(
    stale.map((s) => client.abandonSession(s.id, signal).catch(() => undefined)),
  )
}

export function RecentSessions({ client, onResume }: RecentSessionsProps): ReactElement | null {
  const [state, setState] = useState<LoadState>({ kind: 'idle' })
  const [open, setOpen] = useState(false)
  const panelId = useId()

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
        if (ctrl.signal.aborted) return
        const recent = pickRecent(body.sessions)
        const stale = pickStale(body.sessions)
        // Render the trimmed list immediately; let the manifest cleanup
        // run in the background so the UI never blocks on it.
        setState({ kind: 'ready', sessions: recent })
        if (stale.length > 0) {
          void pruneOldSessions(client, stale, ctrl.signal)
        }
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

  const count = state.kind === 'ready' ? state.sessions.length : state.kind === 'loading' ? null : 0
  const countLabel =
    state.kind === 'loading'
      ? 'Loading…'
      : state.kind === 'ready'
        ? state.sessions.length === 0
          ? 'None yet'
          : `${String(state.sessions.length)} session${state.sessions.length === 1 ? '' : 's'}`
        : '—'

  return (
    <section
      className={`recent-sessions${open ? ' recent-sessions-open' : ''}`}
      aria-label="Recent review sessions"
    >
      <button
        type="button"
        className="recent-sessions-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((prev) => !prev)
        }}
      >
        <span className="recent-sessions-toggle-label">
          <span className="recent-sessions-toggle-chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          Recent sessions
        </span>
        <span className="recent-sessions-toggle-meta">
          {count !== null && count > 0 ? (
            <span className="recent-sessions-toggle-badge">{String(count)}</span>
          ) : null}
          <span className="recent-sessions-count">{countLabel}</span>
        </span>
      </button>

      {open ? (
        <div className="recent-sessions-panel" id={panelId}>
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
        </div>
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
