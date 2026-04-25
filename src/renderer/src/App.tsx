import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { clientFromCredentials } from './api/sessions'
import { CommitPanel } from './components/CommitPanel'
import { DetectionSidebar } from './components/DetectionSidebar'
import { DetectionTooltip } from './components/DetectionTooltip'
import { DocxView } from './components/DocxView'
import { DropZone } from './components/DropZone'
import { RecentSessions } from './components/RecentSessions'
import { SelectModeBanner } from './components/SelectModeBanner'
import { Splash } from './components/Splash'
import { seedFakeDetections } from './review/fake-detections'
import { useReviewKeyboard } from './review/keyboard'
import { useReviewStore } from './review/store'
import type { SanctumStatus } from './sanctum'

export function App(): ReactElement {
  const [status, setStatus] = useState<SanctumStatus>({ state: 'idle' })
  const [doc, setDoc] = useState<File | null>(null)
  const [docRoot, setDocRoot] = useState<HTMLElement | null>(null)

  const detections = useReviewStore((s) => s.detections)
  const focusedId = useReviewStore((s) => s.focusedId)
  const setStoreDetections = useReviewStore((s) => s.setDetections)
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

  useReviewKeyboard(reviewMode, docRoot)

  const handleFile = useCallback(
    (file: File) => {
      setDoc(file)
      clearStore()
    },
    [clearStore],
  )

  const handleClose = useCallback(() => {
    setDoc(null)
    setDocRoot(null)
    clearStore()
  }, [clearStore])

  const handleRendered = useCallback(
    (root: HTMLElement) => {
      setDocRoot(root)
      setStoreDetections(seedFakeDetections(root))
    },
    [setStoreDetections],
  )

  const sessionsClient = useMemo(() => {
    if (status.state !== 'ready') return null
    return clientFromCredentials({ baseUrl: status.baseUrl, token: status.token })
  }, [status])

  const handleResume = useCallback((sessionId: string) => {
    // Slice 2 wires this to a GET /review-sessions/{id} + setDetections.
    // For now the click is intentionally a no-op so the list can ship
    // first — the row's hover state and counts are useful on their own.
    console.info('[sanctum] resume requested for session', sessionId)
  }, [])

  return (
    <main className={`shell${reviewMode ? ' shell-review' : ''}`}>
      <header>
        <h1>Sanctum Desktop</h1>
        <p className="tagline">Local-first document anonymization — coming soon.</p>
      </header>
      {showBackendStatus ? <Splash status={status} /> : null}
      {reviewMode ? (
        <div className="review-layout">
          <DocxView
            file={doc}
            onClose={handleClose}
            detections={detections}
            focusedId={focusedId}
            onRendered={handleRendered}
          />
          <DetectionSidebar />
          <DetectionTooltip anchorRoot={docRoot} />
          <SelectModeBanner />
          <CommitPanel />
        </div>
      ) : (
        <div className="landing">
          <RecentSessions client={sessionsClient} onResume={handleResume} />
          <DropZone onFile={handleFile} />
        </div>
      )}
    </main>
  )
}
