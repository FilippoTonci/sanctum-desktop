import type { ReactElement } from 'react'
import { Icon, Kbd } from './Icon'

interface DropZoneProps {
  /** Opens the file picker (App owns the single hidden file input). */
  readonly onBrowse: () => void
  /** True while a file is dragged over the window. */
  readonly dragActive: boolean
  /** Last rejected-file message, if any. */
  readonly error: string | null
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
export const PDF_MIME = 'application/pdf'

/** File-picker `accept` list: the formats the review canvas can render. */
export const ACCEPTED_EXTENSIONS = '.docx,.pptx,.pdf'

/** True for a PowerPoint deck (reviewed on the slide canvas, not docx-preview). */
export function isPptxFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type === PPTX_MIME || file.name.toLowerCase().endsWith('.pptx')
}

/** True for a PDF (PDF.js pages under the engine's text-line layer). */
export function isPdfFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type === PDF_MIME || file.name.toLowerCase().endsWith('.pdf')
}

/** Returns an error message for a file the app cannot open, or null. */
export function rejectReason(file: File | undefined): string | null {
  if (file === undefined) return 'No file received.'
  const isDocx = file.type === DOCX_MIME || file.name.toLowerCase().endsWith('.docx')
  if (!isDocx && !isPptxFile(file) && !isPdfFile(file)) {
    return `Only Word (.docx), PowerPoint (.pptx) and PDF files can be opened. "${file.name}" is not one.`
  }
  return null
}

/**
 * Home canvas: the whole main area is the drop target (the drag handlers
 * live on the app root so a drop anywhere in the window works).
 */
export function DropZone({ onBrowse, dragActive, error }: DropZoneProps): ReactElement {
  return (
    <section className="home" aria-label="Open a document">
      <div className={`drop-target${dragActive ? ' is-active' : ''}`} data-testid="drop-zone">
        <div className="drop-icon" aria-hidden="true">
          <Icon name="doc" size={28} />
        </div>
        <h1 className="home-title">Drop a Word, PowerPoint or PDF file to review</h1>
        <p className="home-lede">
          Sanctum flags names, addresses, dates and account numbers. You confirm each one, then save
          a redacted copy. The document never leaves this computer.
        </p>
        <button type="button" className="btn btn-primary" onClick={onBrowse}>
          Open document…
          <Kbd keys={['⌘', 'O']} />
        </button>
        {error !== null ? (
          <p className="drop-error" role="alert">
            {error}
          </p>
        ) : null}
        <ol className="home-steps" aria-label="How it works">
          <li>
            <span className="home-step-n">1</span>Open a .docx, .pptx or .pdf
          </li>
          <li>
            <span className="home-step-n">2</span>Review with <Kbd keys={['↵']} /> and{' '}
            <Kbd keys={['⌫']} />
          </li>
          <li>
            <span className="home-step-n">3</span>Save a redacted copy <Kbd keys={['⌘', 'S']} />
          </li>
        </ol>
      </div>
    </section>
  )
}
