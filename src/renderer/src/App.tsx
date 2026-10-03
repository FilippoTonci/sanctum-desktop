import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
} from 'react'
import { clientFromCredentials, type SessionsClient } from './api/sessions'
import { ApiError, type CreateReviewSessionRequest } from './api/types'
import { CommandPalette, type Command } from './components/CommandPalette'
import { CommitPanel } from './components/CommitPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { DetectionSidebar } from './components/DetectionSidebar'
import { DocxView } from './components/DocxView'
import { DropZone, rejectReason } from './components/DropZone'
import { EditReplacement } from './components/EditReplacement'
import { Inspector } from './components/Inspector'
import { RecentSessions } from './components/RecentSessions'
import { ReviewToolbar } from './components/ReviewToolbar'
import { SETTINGS_SECTIONS, SettingsView, type SettingsSection } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { Splash } from './components/Splash'
import { TypedError } from './components/TypedError'
import { decideAllPendingOfType } from './review/bulk'
import { entityLabel } from './review/entities'
import { seedFakeDetections } from './review/fake-detections'
import { previewsForStore, sessionToDetections } from './review/from-session'
import { runMenuUndo } from './menu-undo'
import { isInputFocused, useReviewKeyboard } from './review/keyboard'
import { useMissedSelectionTracker } from './review/selection-tracker'
import { extractSegmentOrder } from './review/segments'
import { useReviewStore } from './review/store'
import { OPERATOR_NAMES, type OperatorName } from './review/types'
import { localActions, syncedActions, type ReviewActions } from './review/actions'
import { ReviewActionsProvider } from './review/use-actions'
import type { AppSettings, SanctumStatus, ThemePreference } from './sanctum'

type AnalysisState =
  | { kind: 'fake' }
  | { kind: 'waiting' }
  | { kind: 'pending' }
  | { kind: 'ready' }
  | { kind: 'error'; error: unknown }

/** Pending destructive action awaiting the discard-review confirmation. */
type ConfirmState =
  | { kind: 'close' }
  | { kind: 'open'; file: File }
  | { kind: 'resume'; sessionId: string }
  | null

/**
 * The only operator the product uses. The engine still supports others
 * (and the IPC/API code for the mapping store stays in place), but the UI
 * never offers them: every session is created with `replace`.
 */
const SESSION_OPERATOR: OperatorName = 'replace'

const NARROW_QUERY = '(max-width: 1199px)'

export function App(): ReactElement {
  const [status, setStatus] = useState<SanctumStatus>({ state: 'idle' })
  const [doc, setDoc] = useState<File | null>(null)
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [docRoot, setDocRoot] = useState<HTMLElement | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisState>({ kind: 'fake' })
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [view, setView] = useState<'main' | 'settings'>('main')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('detection')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarPref, setSidebarPref] = useState<boolean | null>(null)
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches)
  const [dragActive, setDragActive] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [recentKey, setRecentKey] = useState(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const detections = useReviewStore((s) => s.detections)
  const focusedId = useReviewStore((s) => s.focusedId)
  const commitPanelOpen = useReviewStore((s) => s.commitPanelOpen)
  const pendingMissedSelection = useReviewStore((s) => s.pendingMissedSelection)
  const setFocused = useReviewStore((s) => s.setFocused)
  const setUnwrappableIds = useReviewStore((s) => s.setUnwrappableIds)
  const setStoreDetections = useReviewStore((s) => s.setDetections)
  const setSegmentOrder = useReviewStore((s) => s.setSegmentOrder)
  const setSessionId = useReviewStore((s) => s.setSessionId)
  const setDefaultOperator = useReviewStore((s) => s.setDefaultOperator)
  const setPreviews = useReviewStore((s) => s.setPreviews)
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
    void api.getSettings().then((current) => {
      if (active) setSettings(current)
    })

    const unsubscribe = api.onStatusChange((next) => {
      if (active) setStatus(next)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  // Theme: follow the system unless Settings pins light or dark.
  const themePref: ThemePreference = settings?.theme ?? 'system'
  useEffect(() => {
    const root = document.documentElement
    if (themePref === 'system') delete root.dataset.theme
    else root.dataset.theme = themePref
  }, [themePref])

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY)
    const onChange = (e: MediaQueryListEvent): void => {
      setNarrow(e.matches)
      setSidebarPref(null)
    }
    mq.addEventListener('change', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
    }
  }, [])

  const sidebarCollapsed = sidebarPref ?? narrow
  const reviewMode = doc !== null
  const showBackendStatus = status.state !== 'ready'

  const sessionsClient = useMemo(() => {
    if (status.state !== 'ready') return null
    return clientFromCredentials({ baseUrl: status.baseUrl, token: status.token })
  }, [status])

  // Keyboard handler reaches actions through the same factory the
  // ReviewActionsProvider uses below — kept in sync via a shared memo so
  // "what the buttons do" and "what the keys do" never drift.
  const sessionId = useReviewStore((s) => s.sessionId)
  const reviewActions = useMemo<ReviewActions>(() => {
    if (sessionsClient === null || sessionId === null) return localActions
    return syncedActions({ client: sessionsClient, sessionId })
  }, [sessionsClient, sessionId])

  const overlayOpen = paletteOpen || commitPanelOpen || confirm !== null
  useReviewKeyboard(reviewMode && view === 'main' && !overlayOpen, docRoot, reviewActions)
  useMissedSelectionTracker(reviewMode ? docRoot : null)

  const handleSettingsChange = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    const next = await window.sanctum?.updateSettings(patch)
    if (next === null || next === undefined) throw new Error('Settings unavailable in this build')
    setSettings(next)
  }, [])

  /** Close the current document, discarding an uncommitted review. */
  const closeDocument = useCallback(() => {
    // If the session is open and the user closes without committing,
    // tell the backend to drop it — keeps the on-disk session store tidy
    // (and deletes its copy of the document). Committed sessions are
    // already torn down server-side.
    const state = useReviewStore.getState()
    if (sessionsClient !== null && state.sessionId !== null && state.commitResult === null) {
      const sid = state.sessionId
      void sessionsClient
        .abandonSession(sid)
        .catch(() => {
          useReviewStore.getState().setLastSyncError(`abandon: failed to delete session ${sid}`)
        })
        .finally(() => {
          setRecentKey((k) => k + 1)
        })
    } else {
      setRecentKey((k) => k + 1)
    }
    setDoc(null)
    setSourcePath(null)
    setDocRoot(null)
    setAnalysis({ kind: 'fake' })
    clearStore()
  }, [clearStore, sessionsClient])

  const openFile = useCallback(
    (file: File) => {
      if (useReviewStore.getState().sessionId !== null || doc !== null) closeDocument()
      setDropError(null)
      setView('main')
      clearStore()
      setSourcePath(window.sanctum?.getFilePath(file) ?? null)
      setDoc(file)
      // Mode is decided in the effect below once `doc` settles.
    },
    [clearStore, closeDocument, doc],
  )

  /** True when closing now would throw away review work. */
  const hasUnsavedWork = useCallback((): boolean => {
    const s = useReviewStore.getState()
    return (
      doc !== null && s.commitResult === null && s.detections.some((d) => d.status !== 'pending')
    )
  }, [doc])

  const requestOpenFile = useCallback(
    (file: File | undefined) => {
      const reason = rejectReason(file)
      if (reason !== null || file === undefined) {
        setDropError(reason)
        return
      }
      if (hasUnsavedWork()) setConfirm({ kind: 'open', file })
      else openFile(file)
    },
    [hasUnsavedWork, openFile],
  )

  const requestClose = useCallback(() => {
    if (hasUnsavedWork()) setConfirm({ kind: 'close' })
    else closeDocument()
  }, [closeDocument, hasUnsavedWork])

  const openPicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleRendered = useCallback(
    (root: HTMLElement) => {
      setDocRoot(root)
      // Snapshot segment DOM order before any detections land in the
      // store so user-added rows slot into document order.
      setSegmentOrder(extractSegmentOrder(root))
      // The seedFakeDetections fallback only fires when we're not
      // talking to a real backend.
      if (analysis.kind === 'fake') {
        setStoreDetections(seedFakeDetections(root))
      }
    },
    [analysis.kind, setSegmentOrder, setStoreDetections],
  )

  // Drive the create-session round-trip whenever the dropped file changes
  // AND we have a usable client + on-disk path. Resumed sessions arrive
  // with sessionId already set and short-circuit here.
  useEffect(() => {
    if (doc === null) return undefined

    if (sessionId !== null) {
      setAnalysis({ kind: 'ready' })
      return undefined
    }

    const path = window.sanctum?.getFilePath(doc) ?? ''
    if (sessionsClient === null && window.sanctum !== undefined && path !== '') {
      // Engine still starting (or restarting after a settings change):
      // wait for it rather than falling back to the fake seeder. This
      // effect re-runs when the client appears.
      setAnalysis({ kind: 'waiting' })
      return undefined
    }
    if (sessionsClient === null || path === '') {
      // Fake-seeder fallback: standalone browser, or a renderer-synthesised
      // File without an on-disk path.
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
        setRecentKey((k) => k + 1)
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

  const resumeSession = useCallback(
    (resumeSessionId: string): void => {
      if (sessionsClient === null) return
      if (doc !== null) closeDocument()
      setView('main')

      // The async fetches run concurrently (session JSON + input bytes),
      // then a single synchronous batch hydrates store + sessionId + doc
      // so the create-session effect above sees the resumed state.
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

          clearStore()
          setSessionId(resumeSessionId)
          if (isOperatorName(session.default_operator)) {
            setDefaultOperator(session.default_operator)
          }
          setStoreDetections(sessionToDetections(session))
          setPreviews(previewsForStore(session))
          setSourcePath(session.source_path)
          setDoc(file)
        } catch (err) {
          if (ctrl.signal.aborted) return
          setAnalysis({ kind: 'error', error: err })
        }
      })()
    },
    [
      sessionsClient,
      doc,
      closeDocument,
      clearStore,
      setSessionId,
      setDefaultOperator,
      setStoreDetections,
      setPreviews,
    ],
  )

  const requestResume = useCallback(
    (id: string) => {
      if (hasUnsavedWork()) setConfirm({ kind: 'resume', sessionId: id })
      else resumeSession(id)
    },
    [hasUnsavedWork, resumeSession],
  )

  const openSettings = useCallback((section?: SettingsSection) => {
    if (section !== undefined) setSettingsSection(section)
    setView('settings')
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarPref(!sidebarCollapsed)
  }, [sidebarCollapsed])

  // Native menu commands. The menu owns the modifier shortcuts (⌘O, ⌘W, ⌘S,
  // ⌘Z, ⌘K, ⌘,, ⌘\\); each command runs the same handler the palette uses, so
  // open and close go through the confirm-before-discard flow.
  useEffect(() => {
    const api = window.sanctum
    if (api === undefined) return undefined
    return api.onMenuCommand((cmd) => {
      if (cmd === 'palette') {
        setPaletteOpen((o) => !o)
        return
      }
      if (cmd === 'undo') {
        runMenuUndo({
          inputFocused: isInputFocused(document.activeElement),
          blocked: confirm !== null || commitPanelOpen,
          undoStackSize: useReviewStore.getState().undoStack.length,
          // execCommand is the only renderer-side way to run a text field's native undo.
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          nativeUndo: () => document.execCommand('undo'),
          undoDecision: () => {
            reviewActions.undoLastDecision()
          },
        })
        return
      }
      if (confirm !== null || commitPanelOpen) return
      setPaletteOpen(false)
      switch (cmd) {
        case 'open':
          openPicker()
          break
        case 'close':
          // No document: ⌘W closes the window, like the native role.
          if (doc !== null) requestClose()
          else window.close()
          break
        case 'save':
          if (doc !== null) {
            setView('main')
            useReviewStore.getState().openCommitPanel()
          }
          break
        case 'settings':
          openSettings()
          break
        case 'toggle-sidebar':
          toggleSidebar()
          break
      }
    })
  }, [
    commitPanelOpen,
    confirm,
    doc,
    openPicker,
    openSettings,
    requestClose,
    reviewActions,
    toggleSidebar,
  ])

  // Escape leaves Settings. Everything modifier-based is a menu accelerator.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (
        e.key === 'Escape' &&
        view === 'settings' &&
        !overlayOpen &&
        !isInputFocused(e.target) &&
        !e.defaultPrevented
      ) {
        e.preventDefault()
        setView('main')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [overlayOpen, view])

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = []
    const focused = detections.find((d) => d.id === focusedId)
    const store = useReviewStore.getState
    if (reviewMode) {
      const REVIEW = 'Review'
      list.push(
        {
          id: 'redact',
          group: REVIEW,
          title: 'Redact selected detection',
          keywords: 'accept',
          keys: ['↵'],
          disabled: focused === undefined,
          run: () => {
            if (focused === undefined) return
            reviewActions.accept(focused.id)
            store().focusNextPending()
          },
        },
        {
          id: 'keep',
          group: REVIEW,
          title: 'Keep original text',
          keywords: 'reject dismiss',
          keys: ['⌫'],
          disabled: focused === undefined,
          run: () => {
            if (focused === undefined) return
            reviewActions.reject(focused.id)
            store().focusNextPending()
          },
        },
        {
          id: 'edit',
          group: REVIEW,
          title: 'Edit replacement',
          keys: ['E'],
          disabled: focused === undefined,
          run: () => {
            if (focused !== undefined) store().startEditingReplacement(focused.id)
          },
        },
        {
          id: 'next-pending',
          group: REVIEW,
          title: 'Go to next detection to review',
          keywords: 'pending jump',
          keys: ['N'],
          run: () => {
            store().focusNextPending()
          },
        },
        {
          id: 'mark-missed',
          group: REVIEW,
          title: 'Mark selected text as missed PII',
          keywords: 'add user',
          keys: ['M'],
          disabled: pendingMissedSelection === null,
          run: () => {
            const pending = store().pendingMissedSelection
            if (pending !== null) reviewActions.addMissed(pending)
          },
        },
      )
      const types = [...new Set(detections.map((d) => d.entityType))]
      for (const t of types) {
        const pending = detections.filter((d) => d.entityType === t && d.status === 'pending')
        if (pending.length === 0) continue
        const isFocusedType = focused?.entityType === t
        list.push(
          {
            id: `redact-all-${t}`,
            group: REVIEW,
            title: `Redact all ${entityLabel(t)} (${String(pending.length)} to review)`,
            keywords: `accept bulk ${t}`,
            keys: isFocusedType ? ['⇧', 'A'] : undefined,
            run: () => {
              decideAllPendingOfType(store().detections, t, 'accept', reviewActions)
            },
          },
          {
            id: `keep-all-${t}`,
            group: REVIEW,
            title: `Keep all ${entityLabel(t)} (${String(pending.length)} to review)`,
            keywords: `reject bulk ${t}`,
            keys: isFocusedType ? ['⇧', 'R'] : undefined,
            run: () => {
              decideAllPendingOfType(store().detections, t, 'reject', reviewActions)
            },
          },
        )
      }
      list.push(
        {
          id: 'undo',
          group: REVIEW,
          title: 'Undo last decision',
          keys: ['⌘', 'Z'],
          disabled: store().undoStack.length === 0,
          run: () => {
            reviewActions.undoLastDecision()
          },
        },
        {
          id: 'save',
          group: REVIEW,
          title: 'Save redacted copy',
          keywords: 'commit export',
          keys: ['⌘', 'S'],
          run: () => {
            store().openCommitPanel()
          },
        },
        {
          id: 'close',
          group: REVIEW,
          title: 'Close document',
          keywords: 'discard abandon',
          run: requestClose,
        },
      )
    }
    list.push({
      id: 'open',
      group: 'Documents',
      title: 'Open document…',
      keywords: 'file docx new',
      keys: ['⌘', 'O'],
      run: openPicker,
    })
    list.push(
      {
        id: 'settings',
        group: 'Go to',
        title: 'Settings',
        keywords: 'preferences',
        keys: ['⌘', ','],
        run: () => {
          openSettings()
        },
      },
      ...SETTINGS_SECTIONS.map<Command>((s) => ({
        id: `settings-${s.id}`,
        group: 'Go to',
        title: `Settings: ${s.label}`,
        keywords: 'preferences',
        run: () => {
          openSettings(s.id)
        },
      })),
      {
        id: 'sidebar',
        group: 'Go to',
        title: sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar',
        keywords: 'toggle panel',
        keys: ['⌘', '\\'],
        run: toggleSidebar,
      },
    )
    if (settings !== null) {
      const themes: readonly [ThemePreference, string][] = [
        ['system', 'Match system'],
        ['light', 'Light'],
        ['dark', 'Dark'],
      ]
      for (const [id, label] of themes) {
        list.push({
          id: `theme-${id}`,
          group: 'Appearance',
          title: `Theme: ${label}`,
          keywords: 'appearance color mode',
          disabled: settings.theme === id,
          run: () => {
            void handleSettingsChange({ theme: id })
          },
        })
      }
    }
    return list
  }, [
    detections,
    focusedId,
    handleSettingsChange,
    openPicker,
    openSettings,
    pendingMissedSelection,
    requestClose,
    reviewActions,
    reviewMode,
    settings,
    sidebarCollapsed,
    toggleSidebar,
  ])

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    if (!dragActive) setDragActive(true)
  }
  const onDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    if (e.relatedTarget === null) setDragActive(false)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragActive(false)
    requestOpenFile(e.dataTransfer.files[0])
  }

  const confirmDiscard = (): void => {
    const c = confirm
    setConfirm(null)
    if (c === null) return
    if (c.kind === 'close') closeDocument()
    else if (c.kind === 'open') openFile(c.file)
    else resumeSession(c.sessionId)
  }

  return (
    <ReviewActionsProvider client={sessionsClient} sessionId={sessionId}>
      <div
        className={`app${reviewMode ? ' is-review' : ''}${sidebarCollapsed ? ' is-rail' : ''}${
          dragActive ? ' is-dragging' : ''
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <Sidebar
          collapsed={sidebarCollapsed}
          status={status}
          settingsActive={view === 'settings'}
          onOpen={openPicker}
          onPalette={() => {
            setPaletteOpen(true)
          }}
          onSettings={() => {
            if (view === 'settings') setView('main')
            else openSettings()
          }}
          onToggle={toggleSidebar}
        >
          <RecentSessions
            client={sessionsClient}
            onResume={requestResume}
            currentSessionId={sessionId}
            refreshKey={recentKey}
          />
          {reviewMode ? <DetectionSidebar /> : null}
        </Sidebar>

        <main className="main">
          {showBackendStatus ? <Splash status={status} /> : null}
          {reviewMode ? (
            <div className="review">
              <ReviewToolbar
                fileName={doc.name}
                fileSize={doc.size}
                onClose={requestClose}
                onUndo={() => {
                  reviewActions.undoLastDecision()
                }}
              />
              <DocxView
                file={doc}
                detections={detections}
                focusedId={focusedId}
                onRendered={handleRendered}
                onFocusDetection={setFocused}
                onUnwrappable={setUnwrappableIds}
              />
              <EditReplacement anchorRoot={docRoot} />
              <AnalysisBanner state={analysis} />
              <SyncErrorToast />
            </div>
          ) : (
            <>
              <DropZone onBrowse={openPicker} dragActive={dragActive} error={dropError} />
              <AnalysisBanner state={analysis} />
            </>
          )}
        </main>

        {reviewMode ? <Inspector /> : null}

        {view === 'settings' ? (
          <SettingsView
            settings={settings}
            status={status}
            section={settingsSection}
            onSectionChange={setSettingsSection}
            onChange={handleSettingsChange}
            onClose={() => {
              setView('main')
            }}
          />
        ) : null}

        {reviewMode ? (
          <CommitPanel
            client={sessionsClient}
            sourceFileName={doc.name}
            sourcePath={sourcePath}
            outputSuffix={settings?.outputSuffix ?? '_anonymized'}
            saveNextToOriginal={settings?.saveNextToOriginal ?? true}
            onDone={closeDocument}
            onOpenAnother={() => {
              closeDocument()
              openPicker()
            }}
          />
        ) : null}

        <CommandPalette
          open={paletteOpen}
          commands={commands}
          onClose={() => {
            setPaletteOpen(false)
          }}
        />

        {confirm !== null ? (
          <ConfirmDialog
            title={`Close ${doc?.name ?? 'this document'}?`}
            body="Your review decisions will be discarded and Sanctum's working copy of the document is deleted. The original file is not touched."
            confirmLabel="Discard review"
            onConfirm={confirmDiscard}
            onCancel={() => {
              setConfirm(null)
            }}
          />
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept=".docx"
          data-testid="drop-zone-input"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            requestOpenFile(file)
          }}
        />
      </div>
    </ReviewActionsProvider>
  )
}

interface RunAnalysisArgs {
  readonly client: SessionsClient
  readonly path: string
  readonly signal: AbortSignal
  readonly onSuccess: (response: Awaited<ReturnType<SessionsClient['createSession']>>) => void
  readonly onError: (err: unknown) => void
}

/**
 * Build the create-session body from Settings: always the `replace`
 * operator, with the chosen replacement style and entity filter.
 * Exported for tests.
 */
export function sessionRequestFromSettings(
  path: string,
  settings: AppSettings | null | undefined,
): CreateReviewSessionRequest {
  const fixed = settings?.replacementStyle === 'fixed'
  return {
    input_path: path,
    default_operator: SESSION_OPERATOR,
    ...(fixed ? { default_operator_params: { new_value: settings.replacementText } } : {}),
    ...(settings?.entityTypes !== null && settings?.entityTypes !== undefined
      ? { entities: settings.entityTypes }
      : {}),
  }
}

async function runAnalysis(args: RunAnalysisArgs): Promise<void> {
  try {
    const settings = await window.sanctum?.getSettings()
    const response = await args.client.createSession(
      sessionRequestFromSettings(args.path, settings),
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
  if (state.kind === 'pending' || state.kind === 'waiting') {
    return (
      <div className="toast toast-status" role="status">
        <span className="spinner" aria-hidden="true" />
        {state.kind === 'pending'
          ? 'Finding personal data…'
          : 'Waiting for the detection engine to start…'}
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="toast-host">
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
 * `source_path` (either separator). Falls back to 'session.docx'.
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
  // the status code.
  const fauxError =
    lastSyncError.status !== null
      ? new ApiError(lastSyncError.status, null, lastSyncError.message)
      : new Error(lastSyncError.message)
  return (
    <div className="toast-host">
      <TypedError
        error={fauxError}
        onDismiss={() => {
          setLastSyncError(null)
        }}
      />
    </div>
  )
}
