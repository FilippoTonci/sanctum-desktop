import { useEffect, useRef, useState, type ReactElement } from 'react'
import { renderAsync } from 'docx-preview'
import { wrapDetections } from '../review/edit-wrap'
import { applyHighlightRegistries, resolveDetections } from '../review/highlights'
import type { Detection } from '../review/types'
import { detectionIdFromClick } from '../review/click-focus'

interface DocxViewProps {
  readonly file: File
  readonly onClose: () => void
  readonly detections: readonly Detection[]
  readonly focusedId: string | null
  readonly onRendered?: (root: HTMLElement) => void
  readonly onFocusDetection?: (id: string) => void
}

type RenderState = { kind: 'rendering' } | { kind: 'ready' } | { kind: 'error'; message: string }

export function DocxView({
  file,
  onClose,
  detections,
  focusedId,
  onRendered,
  onFocusDetection,
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
    // Order matters: wrap first so resolveDetections builds ranges
    // against the wrap elements (stable across surroundContents) and
    // the highlight Ranges paint over whichever child the CSS shows
    // (original when pending/rejected, replacement when accepted).
    wrapDetections(host, detections)
    const resolved = resolveDetections(host, detections)
    applyHighlightRegistries(resolved, focusedId)
  }, [state.kind, detections, focusedId])

  // Native listener rather than an onClick prop: the docx body is a
  // document surface, not a control, so an onClick on the <div> trips
  // jsx-a11y's click-events-have-key-events / no-static-element-interactions.
  // Keyboard access to the same behaviour already exists via the arrow keys
  // (see review/keyboard.ts).
  useEffect(() => {
    const host = bodyRef.current
    if (host === null) return undefined
    if (onFocusDetection === undefined) return undefined

    const handleClick = (event: MouseEvent): void => {
      const collapsed = host.ownerDocument.defaultView?.getSelection()?.isCollapsed ?? true
      const id = detectionIdFromClick(event.target, collapsed)
      if (id !== null) onFocusDetection(id)
    }

    host.addEventListener('click', handleClick)
    return () => {
      host.removeEventListener('click', handleClick)
    }
  }, [onFocusDetection])

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
