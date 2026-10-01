import { useEffect, useState, type ReactElement } from 'react'
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
  /** Session currently open in the review surface; rendered as active. */
  readonly currentSessionId?: string | null
  /** Bump to force a re-fetch (e.g. after closing or saving a document). */
  readonly refreshKey?: number
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

export function RecentSessions({
  client,
  onResume,
  currentSessionId = null,
  refreshKey = 0,
}: RecentSessionsProps): ReactElement | null {
  const [state, setState] = useState<LoadState>({ kind: 'idle' })

  useEffect(() => {
    if (client === null) {
      setState({ kind: 'idle' })
      return undefined
    }
    const ctrl = new AbortController()
    setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }))
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
  }, [client, refreshKey])

  // Standalone-browser mode (no client) → omit the list entirely; an
  // explicit empty state would be misleading.
  if (client === null) return null

  return (
    <section className="recent" aria-label="Recent documents">
      <header className="panel-head">
        <h2 className="panel-title">Recent</h2>
      </header>
      {state.kind === 'loading' ? (
        <p className="panel-empty" role="status">
          Loading…
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p className="panel-empty panel-error" role="alert">
          Could not load recent documents: {state.message}
        </p>
      ) : null}
      {state.kind === 'ready' && state.sessions.length === 0 ? (
        <p className="panel-empty">Documents you review appear here.</p>
      ) : null}
      {state.kind === 'ready' && state.sessions.length > 0 ? (
        <ul className="recent-list">
          {state.sessions.map((s) => {
            const resumable = s.status === 'open'
            const active = s.id === currentSessionId
            const total = s.pending_count + s.accepted_count + s.rejected_count
            const reviewed = s.accepted_count + s.rejected_count
            const tooltip = resumable
              ? `${s.source_path}\nReview in progress: ${String(reviewed)} of ${String(total)} reviewed`
              : `${s.source_path}\n${statusText(s.status)}. The review can't be reopened.`
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`recent-item${active ? ' is-active' : ''}`}
                  onClick={resumable && !active ? () => onResume?.(s.id) : undefined}
                  disabled={!resumable}
                  aria-current={active ? 'true' : undefined}
                  title={tooltip}
                >
                  <span className={`recent-dot recent-dot-${s.status}`} aria-hidden="true" />
                  <span className="recent-name">{filename(s.source_path)}</span>
                  <span className="recent-meta">
                    {resumable
                      ? `${String(reviewed)}/${String(total)}`
                      : formatRelative(s.created_at)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}

function statusText(status: ReviewSessionIndexEntry['status']): string {
  switch (status) {
    case 'open':
      return 'In progress'
    case 'committed':
      return 'Saved'
    case 'abandoned':
      return 'Closed without saving'
  }
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
