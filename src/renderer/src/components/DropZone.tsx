import { useCallback, useRef, useState, type DragEvent, type ReactElement } from 'react'

interface DropZoneProps {
  readonly onFile: (file: File) => void
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function DropZone({ onFile }: DropZoneProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accept = useCallback(
    (file: File | undefined) => {
      if (file === undefined) {
        setError('No file received.')
        return
      }
      const isDocx = file.type === DOCX_MIME || file.name.toLowerCase().endsWith('.docx')
      if (!isDocx) {
        setError(`Only .docx files are supported (got "${file.name}").`)
        return
      }
      setError(null)
      onFile(file)
    },
    [onFile],
  )

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragActive(false)
    accept(e.dataTransfer.files[0])
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    if (!dragActive) setDragActive(true)
  }

  const openFilePicker = (): void => {
    inputRef.current?.click()
  }

  return (
    <div
      className={`drop-zone${dragActive ? ' drop-zone-active' : ''}`}
      data-testid="drop-zone"
      onDragOver={onDragOver}
      onDragLeave={() => {
        setDragActive(false)
      }}
      onDrop={onDrop}
    >
      <p className="drop-zone-headline">Drop a .docx file to begin</p>
      <p className="drop-zone-hint">or use the button below to browse</p>
      <button type="button" className="drop-zone-browse" onClick={openFilePicker}>
        Browse for a file
      </button>
      {error !== null ? (
        <p className="drop-zone-error" role="alert">
          {error}
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept=".docx"
        data-testid="drop-zone-input"
        className="drop-zone-input"
        onChange={(e) => {
          accept(e.currentTarget.files?.[0])
        }}
      />
    </div>
  )
}
