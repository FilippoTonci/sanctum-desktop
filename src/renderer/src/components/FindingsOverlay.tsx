import { useEffect, type ReactElement } from 'react'
import { useReviewStore } from '../review/store'
import { DetectionSidebar } from './DetectionSidebar'

/**
 * Narrow windows collapse the sidebar to a rail, which hides the findings
 * list. This panel brings the very same list back as an overlay anchored
 * to the left edge. It closes on Esc, on an outside click and on choosing
 * a row (which focuses that finding).
 */
export function FindingsOverlay({ bySlide }: { readonly bySlide: boolean }): ReactElement | null {
  const open = useReviewStore((s) => s.findingsOverlayOpen)
  const setOpen = useReviewStore((s) => s.setFindingsOverlayOpen)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, setOpen])

  if (!open) return null
  const close = (): void => {
    setOpen(false)
  }
  return (
    <>
      <button
        type="button"
        className="findings-backdrop"
        aria-label="Close findings"
        tabIndex={-1}
        onClick={close}
      />
      <div className="findings-overlay" id="findings-overlay" role="dialog" aria-label="Findings">
        <DetectionSidebar bySlide={bySlide} onRowChosen={close} />
      </div>
    </>
  )
}
