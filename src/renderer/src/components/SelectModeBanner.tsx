import { type ReactElement } from 'react'
import { useReviewStore } from '../review/store'

export function SelectModeBanner(): ReactElement | null {
  const selectMode = useReviewStore((s) => s.selectMode)
  const exit = useReviewStore((s) => s.exitSelectMode)

  if (!selectMode) return null

  return (
    <div className="select-mode-banner" role="status" data-testid="select-mode-banner">
      <span className="select-mode-banner-text">
        Select the missed text in the document, then press <kbd>Enter</kbd> to add it.
      </span>
      <button
        type="button"
        className="select-mode-banner-cancel"
        onClick={() => {
          exit()
        }}
      >
        Cancel <kbd>Esc</kbd>
      </button>
    </div>
  )
}
