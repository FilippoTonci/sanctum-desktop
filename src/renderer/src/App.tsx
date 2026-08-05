import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { mappingClientFromCredentials } from './api/mapping'
import { clientFromCredentials, type SessionsClient } from './api/sessions'
import { ApiError } from './api/types'
import { CommitPanel } from './components/CommitPanel'
import { DetectionSidebar } from './components/DetectionSidebar'
import { DocxView } from './components/DocxView'
import { DropZone } from './components/DropZone'
import { EditReplacement } from './components/EditReplacement'
import { MappingStoreChip } from './components/MappingStoreChip'
import { RecentSessions } from './components/RecentSessions'
import { SanctumEmblem } from './components/SanctumEmblem'
import { SettingsModal } from './components/SettingsModal'
import { Splash } from './components/Splash'
import { TypedError } from './components/TypedError'
import { seedFakeDetections } from './review/fake-detections'
import { previewsForStore, sessionToDetections } from './review/from-session'
import { useReviewKeyboard } from './review/keyboard'
import { useMissedSelectionTracker } from './review/selection-tracker'
import { extractSegmentOrder } from './review/segments'
import { useReviewStore } from './review/store'
import { OPERATOR_NAMES, type OperatorName } from './review/types'
import { localActions, syncedActions, type ReviewActions } from './review/actions'
import { ReviewActionsProvider } from './review/use-actions'
import type { SanctumStatus } from './sanctum'

type AnalysisState =
  | { kind: 'fake' }
  | { kind: 'pending' }
  | { kind: 'ready' }
  | { kind: 'error'; error: unknown }

export function App(): ReactElement {
  const [status, setStatus] = useState<SanctumStatus>({ state: 'idle' })
  const [doc, setDoc] = useState<File | null>(null)
  const [docRoot, setDocRoot] = useState<HTMLElement | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisState>({ kind: 'fake' })
  const [settingsOpen, setSettingsOpen] = useState(false)

  const detections = useReviewStore((s) => s.detections)
  const focusedId = useReviewStore((s) => s.focusedId)
  const setFocused = useReviewStore((s) => s.setFocused)
  const setUnwrappableIds = useReviewStore((s) => s.setUnwrappableIds)
  const setStoreDetections = useReviewStore((s) => s.setDetections)
  const setSegmentOrder = useReviewStore((s) => s.setSegmentOrder)
  const setSessionId = useReviewStore((s) => s.setSessionId)
  const setDefaultOperator = useReviewStore((s) => s.setDefaultOperator)
  const setPreviews = useReviewStore((s) => s.setPreviews)
  const setMappingStoreUnlocked = useReviewStore((s) => s.setMappingStoreUnlocked)
  const clearStore = useReviewStore((s) => s.clear)

  useEffect(() => {
    let active = true
    const api = window.sanctum
    if (api === undefined) {
      // Plain-browser preview (Vite dev server hit directly without Electron):
      // no preload, no sidecar — synthesise a 'ready' state so the renderer
      // surface is iterable in isolation.
      setStatus({
        state: 'ready',
        baseUrl: '',
        token: '',
        health: { status: 'ok' },
      })
      return undefined
    }

    void api.getStatus().then((current) => {
      if (active) setStatus(current)
    })

    const unsubscribe = api.onStatusChange((next) => {
      if (active) setStatus(next)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const reviewMode = doc !== null
  const showBackendStatus = status.state !== 'ready'

  const sessionsClient = useMemo(() => {
    if (status.state !== 'ready') return null
    return clientFromCredentials({ baseUrl: status.baseUrl, token: status.token })
  }, [status])

  const mappingClient = useMemo(() => {
    if (status.state !== 'ready') return null
    return mappingClientFromCredentials({ baseUrl: status.baseUrl, token: status.token })
  }, [status])

  // Mirror the /health-reported lock state into the store on every
  // status change. unlock/lock round-trips will overwrite locally;
  // a fresh /health poll (e.g. on sidecar respawn) re-syncs.
  useEffect(() => {
    if (status.state !== 'ready') return
    setMappingStoreUnlocked(status.health.mapping_store_unlocked ?? null)
  }, [status, setMappingStoreUnlocked])

  // Keyboard handler reaches actions through the same factory the
  // ReviewActionsProvider uses below — kept in sync via a shared
  // memo so we never accidentally drift between "what the buttons
  // do" (provider) and "what the keys do" (this hook).
  const sessionId = useReviewStore((s) => s.sessionId)
  const reviewActions = useMemo<ReviewActions>(() => {
    if (sessionsClient === null || sessionId === null) return localActions
    return syncedActions({ client: sessionsClient, sessionId })
  }, [sessionsClient, sessionId])

  useReviewKeyboard(reviewMode, docRoot, reviewActions)
  useMissedSelectionTracker(reviewMode ? docRoot : null)

  const handleFile = useCallback(
    (file: File) => {
      setDoc(file)
      clearStore()
      // Mode is decided in the effect below once `doc` settles.
    },
    [clearStore],
  )

  const handleClose = useCallback(() => {
    // If the session is open and the user closes without committing,
    // tell the backend to drop it — keeps the on-disk session store
    // tidy and prevents stale entries piling up in the Recent Sessions
    // list. We only DELETE when the session hasn't already been
    // committed (commit deletes the session dir on its own).
    const state = useReviewStore.getState()
    if (sessionsClient !== null && state.sessionId !== null && state.commitResult === null) {
      const sid = state.sessionId
      void sessionsClient.abandonSession(sid).catch(() => {
        // Don't block local close on a failed DELETE — the user wants
        // out and we already cleared the local view. Surface via the
        // sync-error toast so it isn't silently swallowed.
        useReviewStore.getState().setLastSyncError(`abandon: failed to delete session ${sid}`)
      })
    }
    setDoc(null)
    setDocRoot(null)
    setAnalysis({ kind: 'fake' })
    clearStore()
  }, [clearStore, sessionsClient])

  const handleRendered = useCallback(
    (root: HTMLElement) => {
      setDocRoot(root)
      // Snapshot segment DOM order before any detections land in the
      // store; appendDetection / addMissed / setDetections sort against
      // this so a freshly user-added row slots into its document-order
      // position (arrow-down then steps to the next PII downstream
      // instead of jumping to the trailing USER_ADDED slot).
      setSegmentOrder(extractSegmentOrder(root))
      // The seedFakeDetections fallback only fires when we're not
      // talking to a real backend. Real-mode detections arrive via the
      // POST round-trip the effect below kicks off.
      if (analysis.kind === 'fake') {
        setStoreDetections(seedFakeDetections(root))
      }
    },
    [analysis.kind, setSegmentOrder, setStoreDetections],
  )

  // Drive the create-session round-trip whenever the dropped file
  // changes AND we have a usable client + on-disk path. Fires exactly
  // once per file because the cleanup function aborts the in-flight
  // POST if `doc` is replaced before it returns.
  //
  // Resume short-circuit: handleResume hydrates the store + sessionId
  // synchronously before setDoc, so a non-null sessionId here means
  // "already analysed; skip the create-session round-trip." Fresh
  // drops always pass through `clearStore` first → sessionId is
  // null → the gate stays open.
  useEffect(() => {
    if (doc === null) return undefined

    if (sessionId !== null) {
      setAnalysis({ kind: 'ready' })
      return undefined
    }

    const path = window.sanctum?.getFilePath(doc) ?? ''
    if (sessionsClient === null || path === '') {
      // Fake-seeder fallback: standalone browser, sidecar skipped, or
      // a renderer-synthesised File without an on-disk path.
      setAnalysis({ kind: 'fake' })
      return undefined
    }

    setAnalysis({ kind: 'pending' })
    const ctrl = new AbortController()
    void runAnalysis({
      client: sessionsClient,
      path,
      signal: ctrl.signal,
      onSuccess: (response) => {
        setSessionId(response.id)
        if (isOperatorName(response.default_operator)) {
          setDefaultOperator(response.default_operator)
        }
        setStoreDetections(sessionToDetections(response))
        setPreviews(previewsForStore(response))
        setAnalysis({ kind: 'ready' })
      },
      onError: (err) => {
        setAnalysis({ kind: 'error', error: err })
      },
    })
    return () => {
      ctrl.abort()
    }
  }, [
    doc,
    sessionsClient,
    sessionId,
    setSessionId,
    setDefaultOperator,
    setStoreDetections,
    setPreviews,
  ])

  const handleResume = useCallback(
    (resumeSessionId: string): void => {
      if (sessionsClient === null) return

      // Resume is split between two ticks: the async fetches run
      // concurrently (session JSON + input bytes), then a single
      // synchronous batch hydrates store + sessionId + doc so the
      // create-session effect above sees the resumed state and
      // short-circuits. Errors surface via the AnalysisState union
      // and the existing TypedError surface renders them.
      setAnalysis({ kind: 'pending' })
      const ctrl = new AbortController()
      void (async () => {
        try {
          const [session, blob] = await Promise.all([
            sessionsClient.getSession(resumeSessionId, ctrl.signal),
            sessionsClient.getSessionInput(resumeSessionId, ctrl.signal),
          ])
          if (ctrl.signal.aborted) return

          const filename = filenameFromSourcePath(session.source_path)
          const file = new File([blob], filename, {
            type: blob.type || 'application/octet-stream',
          })

          // Order matters: clear first so we never carry decisions
          // from a prior session into the resumed view, then write
          // the resumed state in the order the create-session effect
          // expects (sessionId before doc so the gate above fires).
          clearStore()
          setSessionId(resumeSessionId)
          if (isOperatorName(session.default_operator)) {
            setDefaultOperator(session.default_operator)
          }
          setStoreDetections(sessionToDetections(session))
          setPreviews(previewsForStore(session))
          setDoc(file)
        } catch (err) {
          if (ctrl.signal.aborted) return
          setAnalysis({ kind: 'error', error: err })
        }
      })()
    },
    [sessionsClient, clearStore, setSessionId, setDefaultOperator, setStoreDetections, setPreviews],
  )

  return (
    <main className={`shell${reviewMode ? ' shell-review' : ''}`}>
      <header className="shell-header">
        <div className="shell-brand">
          <SanctumEmblem />
          <div className="shell-brand-text">
            <p className="shell-eyebrow">
              <span className="shell-eyebrow-dot" aria-hidden="true" />
              <span>Local · Offline · Sealed</span>
            </p>
            <h1>Sanctum Desktop</h1>
            <p className="tagline">
              Local-first sanctuary for sensitive documents — review, redact, and seal without ever
              leaving your machine.
            </p>
          </div>
        </div>
        <div className="shell-header-controls">
          <MappingStoreChip client={mappingClient} />
          {window.sanctum?.getSettings !== undefined ? (
            <button
              type="button"
              className="shell-settings-button"
              onClick={() => {
                setSettingsOpen(true)
              }}
              title="Settings"
              aria-label="Settings"
            >
              ⚙️
            </button>
          ) : null}
        </div>
      </header>
      {settingsOpen ? (
        <SettingsModal
          onClose={() => {
            setSettingsOpen(false)
          }}
        />
      ) : null}
      {showBackendStatus ? <Splash status={status} /> : null}
      {reviewMode ? (
        <ReviewActionsProvider client={sessionsClient} sessionId={sessionId}>
          <div className="review-layout">
            <DocxView
              file={doc}
              onClose={handleClose}
              detections={detections}
              focusedId={focusedId}
              onRendered={handleRendered}
              onFocusDetection={setFocused}
              onUnwrappable={setUnwrappableIds}
            />
            <DetectionSidebar />
            <EditReplacement anchorRoot={docRoot} />
            <CommitPanel client={sessionsClient} sourceFileName={doc.name} onDone={handleClose} />
            <AnalysisBanner state={analysis} />
            <SyncErrorToast />
          </div>
        </ReviewActionsProvider>
      ) : (
        <div className="landing">
          <RecentSessions client={sessionsClient} onResume={handleResume} />
          <DropZone onFile={handleFile} />
        </div>
      )}
    </main>
  )
}

interface RunAnalysisArgs {
  readonly client: SessionsClient
  readonly path: string
  readonly signal: AbortSignal
  readonly onSuccess: (response: Awaited<ReturnType<SessionsClient['createSession']>>) => void
  readonly onError: (err: unknown) => void
}

async function runAnalysis(args: RunAnalysisArgs): Promise<void> {
  try {
    // Honour the Settings panel's default operator so the fresh session
    // matches what the user picked. Fall back to 'replace' when the
    // bridge is unavailable (standalone-browser / sidecar-skip path) or
    // when the persisted value didn't come through — same default as
    // DEFAULT_SETTINGS in src/main/settings.ts.
    const settings = await window.sanctum?.getSettings()
    const defaultOperator = settings?.defaultOperator ?? 'replace'
    const response = await args.client.createSession(
      { input_path: args.path, default_operator: defaultOperator },
      args.signal,
    )
    if (args.signal.aborted) return
    args.onSuccess(response)
  } catch (err) {
    if (args.signal.aborted) return
    args.onError(err)
  }
}

function AnalysisBanner({ state }: { readonly state: AnalysisState }): ReactElement | null {
  if (state.kind === 'pending') {
    return (
      <div className="analysis-banner analysis-banner-pending" role="status">
        <span className="splash-spinner" aria-hidden="true" />
        Analyzing document…
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="analysis-banner-host">
        <TypedError error={state.error} />
      </div>
    )
  }
  return null
}

function isOperatorName(value: string): value is OperatorName {
  return (OPERATOR_NAMES as readonly string[]).includes(value)
}

/**
 * Pull a usable display filename out of the session manifest's
 * `source_path`. The backend stores the absolute path the user dropped
 * the file from, which on Windows can use either separator. A bare
 * fallback ('session.docx') exists for the unreachable corner case
 * where the path has no separator and is empty — keeps `new File`
 * happy without throwing.
 */
function filenameFromSourcePath(sourcePath: string): string {
  const parts = sourcePath.split(/[/\\]/)
  const last = parts[parts.length - 1]
  return last !== undefined && last !== '' ? last : 'session.docx'
}

function SyncErrorToast(): ReactElement | null {
  const lastSyncError = useReviewStore((s) => s.lastSyncError)
  const setLastSyncError = useReviewStore((s) => s.setLastSyncError)
  if (lastSyncError === null) return null
  // Reconstruct an ApiError-shaped object so TypedError can route on
  // the status code. The store doesn't preserve the class identity
  // (it serialises to a plain object), so we use the same .status +
  // .message pair from the error class signature.
  const fauxError =
    lastSyncError.status !== null
      ? new ApiError(lastSyncError.status, null, lastSyncError.message)
      : new Error(lastSyncError.message)
  return (
    <div className="sync-error-toast-host">
      <TypedError
        error={fauxError}
        onDismiss={() => {
          setLastSyncError(null)
        }}
      />
    </div>
  )
}
