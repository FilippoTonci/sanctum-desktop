import { create } from 'zustand'
import type { Detection, DetectionStatus } from './types'

/**
 * Single source of truth for the review session: the detections, the
 * reviewer's verdicts, and which one is focused. Components subscribe
 * with selectors so an accept/reject on one detection re-renders only
 * the rows that actually changed.
 *
 * Shape mirrors what the slice 8 / WS5 wiring will read out of the
 * server-owned ReviewSession: a list with stable ids, plus per-id
 * status overrides. For now the list is seeded by `seedFakeDetections`
 * (slice 4); when the real /review-sessions API lands the same actions
 * (`setDetections`, `setStatus`, `setFocused`) survive the swap.
 */
export interface ReviewState {
  readonly detections: readonly Detection[]
  readonly focusedId: string | null

  setDetections: (detections: readonly Detection[]) => void
  clear: () => void
  setStatus: (id: string, status: DetectionStatus) => void
  setFocused: (id: string | null) => void
  focusNext: () => void
  focusPrev: () => void
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  detections: [],
  focusedId: null,

  setDetections: (detections) => {
    set({
      detections,
      focusedId: detections[0]?.id ?? null,
    })
  },

  clear: () => {
    set({ detections: [], focusedId: null })
  },

  setStatus: (id, status) => {
    set((state) => ({
      detections: state.detections.map((d) => (d.id === id ? { ...d, status } : d)),
    }))
  },

  setFocused: (id) => {
    set({ focusedId: id })
  },

  focusNext: () => {
    const { detections, focusedId } = get()
    if (detections.length === 0) return
    const currentIdx = detections.findIndex((d) => d.id === focusedId)
    const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % detections.length
    set({ focusedId: detections[nextIdx]?.id ?? null })
  },

  focusPrev: () => {
    const { detections, focusedId } = get()
    if (detections.length === 0) return
    const currentIdx = detections.findIndex((d) => d.id === focusedId)
    const prevIdx =
      currentIdx === -1
        ? detections.length - 1
        : (currentIdx - 1 + detections.length) % detections.length
    set({ focusedId: detections[prevIdx]?.id ?? null })
  },
}))
