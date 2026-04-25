import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { DocxView } from './components/DocxView'
import { DropZone } from './components/DropZone'
import { Splash } from './components/Splash'
import { seedFakeDetections } from './review/fake-detections'
import type { Detection } from './review/types'
import type { SanctumStatus } from './sanctum'

export function App(): ReactElement {
  const [status, setStatus] = useState<SanctumStatus>({ state: 'idle' })
  const [doc, setDoc] = useState<File | null>(null)
  const [detections, setDetections] = useState<readonly Detection[]>([])
  const [focusedId, setFocusedId] = useState<string | null>(null)

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

  const handleFile = useCallback((file: File) => {
    setDoc(file)
    setDetections([])
    setFocusedId(null)
  }, [])

  const handleClose = useCallback(() => {
    setDoc(null)
    setDetections([])
    setFocusedId(null)
  }, [])

  const handleRendered = useCallback((root: HTMLElement) => {
    const seeded = seedFakeDetections(root)
    setDetections(seeded)
    setFocusedId(seeded[0]?.id ?? null)
  }, [])

  return (
    <main className={`shell${reviewMode ? ' shell-review' : ''}`}>
      <header>
        <h1>Sanctum Desktop</h1>
        <p className="tagline">Local-first document anonymization — coming soon.</p>
      </header>
      {showBackendStatus ? <Splash status={status} /> : null}
      {reviewMode ? (
        <DocxView
          file={doc}
          onClose={handleClose}
          detections={detections}
          focusedId={focusedId}
          onRendered={handleRendered}
        />
      ) : (
        <DropZone onFile={handleFile} />
      )}
    </main>
  )
}
