import { create } from 'zustand'
import type { SegmentLocator } from './segments'
import type { Detection, DetectionStatus, OperatorName } from './types'

interface StatusEdit {
  readonly id: string
  readonly previous: DetectionStatus
}

export interface MissedSpan {
  readonly locator: SegmentLocator
  readonly text: string
}

/**
 * The shape that lands in the commit panel. Mirrors what the slice 8 /
 * WS5 wiring will POST to `/review-sessions/{id}/commit` once the
 * server-owned ReviewSession contract lands. Each entry is one decision
 * the backend's anonymizer will execute.
 */
export interface CommitDecision {
  readonly id: string
  readonly segmentId: string
  readonly start: number
  readonly end: number
  readonly text: string
  readonly entityType: string
  readonly status: DetectionStatus
  readonly operator?: OperatorName
  readonly customReplacement?: string
  readonly source: 'proposed' | 'user-added'
}

export interface CommitPayload {
  readonly defaultOperator: OperatorName
  readonly decisions: readonly CommitDecision[]
  readonly attestation: string
}

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
  readonly undoStack: readonly StatusEdit[]
  readonly selectMode: boolean
  readonly defaultOperator: OperatorName
  readonly commitPanelOpen: boolean
  /** Backend session id once a real `/review-sessions` round-trip lands. */
  readonly sessionId: string | null

  setDetections: (detections: readonly Detection[]) => void
  setSessionId: (id: string | null) => void
  clear: () => void
  setStatus: (id: string, status: DetectionStatus) => void
  setFocused: (id: string | null) => void
  focusNext: () => void
  focusPrev: () => void
  undoLastDecision: () => void

  enterSelectMode: () => void
  exitSelectMode: () => void
  addMissed: (span: MissedSpan) => string

  setOperator: (id: string, operator: OperatorName) => void
  setCustomReplacement: (id: string, replacement: string | null) => void
  setDefaultOperator: (operator: OperatorName) => void
  startEditingReplacement: (id: string | null) => void
  readonly editingReplacementId: string | null

  openCommitPanel: () => void
  closeCommitPanel: () => void
  buildCommitPayload: (attestation: string) => CommitPayload
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  detections: [],
  focusedId: null,
  undoStack: [],
  selectMode: false,
  defaultOperator: 'hips',
  commitPanelOpen: false,
  editingReplacementId: null,
  sessionId: null,

  setDetections: (detections) => {
    set({
      detections,
      focusedId: detections[0]?.id ?? null,
      undoStack: [],
      selectMode: false,
      commitPanelOpen: false,
      editingReplacementId: null,
    })
  },

  setSessionId: (id) => {
    set({ sessionId: id })
  },

  clear: () => {
    set({
      detections: [],
      focusedId: null,
      undoStack: [],
      selectMode: false,
      commitPanelOpen: false,
      editingReplacementId: null,
      sessionId: null,
    })
  },

  setStatus: (id, status) => {
    set((state) => {
      const target = state.detections.find((d) => d.id === id)
      if (target === undefined || target.status === status) return state
      return {
        detections: state.detections.map((d) => (d.id === id ? { ...d, status } : d)),
        undoStack: [...state.undoStack, { id, previous: target.status }],
      }
    })
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

  undoLastDecision: () => {
    set((state) => {
      const last = state.undoStack[state.undoStack.length - 1]
      if (last === undefined) return state
      return {
        detections: state.detections.map((d) =>
          d.id === last.id ? { ...d, status: last.previous } : d,
        ),
        undoStack: state.undoStack.slice(0, -1),
        focusedId: last.id,
      }
    })
  },

  enterSelectMode: () => {
    set({ selectMode: true })
  },

  exitSelectMode: () => {
    set({ selectMode: false })
  },

  addMissed: (span) => {
    const id = `user:${span.locator.segmentId}:${String(span.locator.start)}-${String(span.locator.end)}`
    set((state) => {
      // If the same span has already been marked, just refocus it.
      if (state.detections.some((d) => d.id === id)) {
        return { selectMode: false, focusedId: id }
      }
      const detection: Detection = {
        id,
        segmentId: span.locator.segmentId,
        start: span.locator.start,
        end: span.locator.end,
        text: span.text,
        entityType: 'USER_ADDED',
        status: 'pending',
      }
      return {
        detections: [...state.detections, detection],
        focusedId: id,
        selectMode: false,
      }
    })
    return id
  },

  setOperator: (id, operator) => {
    set((state) => ({
      detections: state.detections.map((d) => (d.id === id ? { ...d, operator } : d)),
    }))
  },

  setCustomReplacement: (id, replacement) => {
    set((state) => ({
      detections: state.detections.map((d) =>
        d.id === id ? { ...d, customReplacement: replacement ?? undefined } : d,
      ),
    }))
  },

  setDefaultOperator: (operator) => {
    set({ defaultOperator: operator })
  },

  startEditingReplacement: (id) => {
    set({ editingReplacementId: id })
  },

  openCommitPanel: () => {
    set({ commitPanelOpen: true })
  },

  closeCommitPanel: () => {
    set({ commitPanelOpen: false })
  },

  buildCommitPayload: (attestation) => {
    const state = get()
    const decisions: CommitDecision[] = state.detections.map((d) => ({
      id: d.id,
      segmentId: d.segmentId,
      start: d.start,
      end: d.end,
      text: d.text,
      entityType: d.entityType,
      status: d.status,
      operator: d.operator,
      customReplacement: d.customReplacement,
      source: d.id.startsWith('user:') ? 'user-added' : 'proposed',
    }))
    return {
      defaultOperator: state.defaultOperator,
      decisions,
      attestation,
    }
  },
}))
