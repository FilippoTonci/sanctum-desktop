import { useEffect, useRef, useState, type ReactElement } from 'react'
import { renderAsync } from 'docx-preview'
import { applyHighlightRegistries, resolveDetections } from '../review/highlights'
import type { Detection } from '../review/types'

interface DocxViewProps {
  readonly file: File
  readonly onClose: () => void
  readonly detections: readonly Detection[]
  readonly focusedId: string | null
  readonly onRendered?: (root: HTMLElement) => void
}

type RenderState = { kind: 'rendering' } | { kind: 'ready' } | { kind: 'error'; message: string }

export function DocxView({
  file,
  onClose,
  detections,
  focusedId,
  onRendered,
}: DocxViewProps): ReactElement {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<RenderState>({ kind: 'rendering' })

  useEffect(() => {
    const ctrl = { cancelled: false }
    const isCancelled = (): boolean => ctrl.cancelled
    const host = bodyRef.current
    if (host === null) return undefined

    setState({ kind: 'rendering' })

    void (async () => {
      try {
        const buffer = await file.arrayBuffer()
        if (isCancelled()) return
        await renderAsync(buffer, host, undefined, {
          inWrapper: false,
          ignoreWidth: false,
          ignoreHeight: false,
          experimental: false,
          useBase64URL: true,
        })
        if (!isCancelled()) {
          setState({ kind: 'ready' })
          onRendered?.(host)
        }
      } catch (err) {
        if (!isCancelled()) {
          const message = err instanceof Error ? err.message : String(err)
          setState({ kind: 'error', message })
        }
      }
    })()

    return () => {
      ctrl.cancelled = true
      host.replaceChildren()
    }
  }, [file, onRendered])

  useEffect(() => {
    if (state.kind !== 'ready') return
    const host = bodyRef.current
    if (host === null) return
    const resolved = resolveDetections(host, detections)
    applyHighlightRegistries(resolved, focusedId)
  }, [state.kind, detections, focusedId])

  return (
    <section className="docx-view" aria-busy={state.kind === 'rendering'}>
      <header className="docx-view-header">
        <div className="docx-view-meta">
          <strong>{file.name}</strong>
          <span className="docx-view-size">{formatBytes(file.size)}</span>
        </div>
        <button type="button" className="docx-view-close" onClick={onClose}>
          Close
        </button>
      </header>
      {state.kind === 'rendering' ? (
        <p className="docx-view-status" role="status">
          Rendering document…
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p className="docx-view-status docx-view-error" role="alert">
          Could not render this document: {state.message}
        </p>
      ) : null}
      <div ref={bodyRef} className="docx-view-body" data-testid="docx-body" />
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
