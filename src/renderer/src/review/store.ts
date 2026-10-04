import { create } from 'zustand'
import type { SegmentLocator } from './segments'
import {
  headOf,
  headsOf,
  membersOf,
  type Detection,
  type DetectionStatus,
  type OperatorName,
} from './types'

export interface PendingMissedSelection {
  readonly locator: SegmentLocator
  readonly text: string
}

export type UndoEntry =
  | {
      readonly kind: 'status'
      readonly id: string
      readonly previous: DetectionStatus
    }
  | {
      readonly kind: 'user-add'
      readonly id: string
      readonly segmentId: string
      readonly start: number
      readonly end: number
      readonly text: string
      readonly entityType: string
      readonly preview?: string
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
  readonly undoStack: readonly UndoEntry[]
  readonly pendingMissedSelection: PendingMissedSelection | null
  readonly defaultOperator: OperatorName
  readonly commitPanelOpen: boolean
  /** Backend session id once a real `/review-sessions` round-trip lands. */
  readonly sessionId: string | null

  /**
   * Rendered segment ids in document order, captured from the
   * `[data-segment-id]` DOM nodes by `extractSegmentOrder`. Used to sort
   * detections (including freshly user-added ones) into the same order
   * the reader sees, so arrow-down marches forward through the document
   * instead of jumping to the trailing USER_ADDED slot. Empty until the
   * docx-preview render fires `handleRendered`; while empty the store
   * falls back to stable insertion order.
   */
  readonly segmentOrder: readonly string[]
  setSegmentOrder: (order: readonly string[]) => void

  /**
   * Detection ids that `wrapDetections` skipped because
   * `Range.surroundContents` threw — see review/edit-wrap.ts for when
   * that can happen. Such detections cannot be clicked (the CSS Custom
   * Highlight API is not hit-testable) and show no inline replacement.
   *
   * Deliberately has no UI consumer. Manual testing (issue #29) could
   * not produce a single skipped detection, so shipping an affordance
   * for it would be speculative. This slice exists so the condition is
   * observable in devtools if it ever does occur — if you find real
   * input that populates it, that is the signal to build the UI.
   */
  readonly unwrappableIds: readonly string[]
  setUnwrappableIds: (ids: readonly string[]) => void

  setDetections: (detections: readonly Detection[]) => void
  setSessionId: (id: string | null) => void
  /**
   * Add a single detection. Inserted in document order when the segment
   * order snapshot is known; otherwise appended (stable). Used by the
   * synced addMissed flow + the undo restore-on-failure path.
   */
  appendDetection: (detection: Detection) => void
  /** Remove a single detection (used by reject-on-user-added DELETE). */
  removeDetection: (id: string) => void
  /**
   * Refresh where existing detections sit (segment, offsets, text, group
   * fields) from an engine refetch, plus their previews. Verdicts, focus
   * and undo history are kept. Used after a hand-marked span splits a
   * linked finding and the engine renumbers the surviving pieces.
   */
  refreshDetections: (updates: readonly Detection[], previews: Record<string, string>) => void
  clear: () => void

  /**
   * Last error from the backend-sync layer; null when clear. Carries
   * both the message and the HTTP status (if known) so the SyncErrorToast
   * can render a typed surface — see `components/TypedError.tsx`.
   */
  readonly lastSyncError: { readonly status: number | null; readonly message: string } | null
  setLastSyncError: (error: { status: number | null; message: string } | string | null) => void

  /**
   * Set when the session has been successfully committed via
   * `POST /review-sessions/{id}/commit`. The CommitPanel switches to a
   * success state showing the output path; the abandon-on-close path
   * skips its DELETE because the backend already torn the session
   * down at commit time.
   */
  readonly commitResult: { readonly outputPath: string; readonly committedAt: string } | null
  setCommitResult: (result: { outputPath: string; committedAt: string } | null) => void

  /**
   * Mapping-store lock state, mirrored from /health and updated locally
   * after successful unlock/lock round-trips. `null` means we haven't
   * polled /health yet (status still 'idle' / 'starting'). Components
   * that gate on the lock state (e.g. the pseudonymize operator option
   * in the tooltip + commit panel) treat null as "unknown — assume
   * locked" so the user doesn't pick an operator that will fail at
   * commit time.
   */
  readonly mappingStoreUnlocked: boolean | null
  setMappingStoreUnlocked: (unlocked: boolean | null) => void

  /**
   * Per-detection-id preview text — what the operator would replace
   * the detection with. Computed server-side and shipped on every
   * session GET and every decision-touching PATCH/POST. Keys are the
   * renderer's Detection.id (i.e. `user:<ua_id>` for user-added,
   * raw `detection_id` for proposals).
   */
  readonly previews: Readonly<Record<string, string>>
  setPreviews: (map: Record<string, string>) => void
  setPreview: (id: string, preview: string) => void
  clearPreview: (id: string) => void
  setStatus: (id: string, status: DetectionStatus) => void
  setFocused: (id: string | null) => void
  focusNext: () => void
  focusPrev: () => void
  /**
   * Advance focus to the next *pending* detection after the current
   * one, wrapping around the list. If no pending detections remain,
   * focus stays put — the caller's auto-advance UX prefers leaving
   * the user looking at the detection they just decided over a
   * confusing jump back to the top.
   */
  focusNextPending: () => void
  undoLastDecision: () => void
  pushUserAddUndo: (entry: Extract<UndoEntry, { kind: 'user-add' }>) => void

  addMissed: (span: MissedSpan) => string

  setPendingMissedSelection: (value: PendingMissedSelection | null) => void

  setOperator: (id: string, operator: OperatorName) => void
  setCustomReplacement: (id: string, replacement: string | null) => void
  setDefaultOperator: (operator: OperatorName) => void
  startEditingReplacement: (id: string | null) => void
  readonly editingReplacementId: string | null

  openCommitPanel: () => void
  closeCommitPanel: () => void
  buildCommitPayload: (attestation: string) => CommitPayload
}

/**
 * Sort detections by document order: primary key is the segment's
 * position in the rendered DOM (via the captured `segmentOrder`
 * snapshot), secondary key is the detection's `start` offset within
 * its segment. Segments not yet in the snapshot (e.g. detections set
 * before the doc renders) sort to the end — stable, so insertion order
 * is preserved among them.
 */
function sortByDocumentOrder(
  detections: readonly Detection[],
  segmentOrder: readonly string[],
): Detection[] {
  if (segmentOrder.length === 0) return [...detections]
  const index = new Map<string, number>()
  for (let i = 0; i < segmentOrder.length; i++) {
    const seg = segmentOrder[i]
    if (seg !== undefined) index.set(seg, i)
  }
  return [...detections].sort((a, b) => {
    const ai = index.get(a.segmentId) ?? Number.POSITIVE_INFINITY
    const bi = index.get(b.segmentId) ?? Number.POSITIVE_INFINITY
    if (ai !== bi) return ai - bi
    return a.start - b.start
  })
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  detections: [],
  focusedId: null,
  undoStack: [],
  pendingMissedSelection: null,
  defaultOperator: 'replace',
  commitPanelOpen: false,
  editingReplacementId: null,
  sessionId: null,
  lastSyncError: null,
  previews: {},
  commitResult: null,
  mappingStoreUnlocked: null,
  segmentOrder: [],
  unwrappableIds: [],

  setSegmentOrder: (order) => {
    set((state) => ({
      segmentOrder: order,
      detections: sortByDocumentOrder(state.detections, order),
    }))
  },

  setUnwrappableIds: (ids) => {
    set((state) => {
      // Identity-stable when nothing changed: the wrap effect re-runs on
      // every focus change, and a fresh array each time would re-render
      // every sidebar row on each arrow keypress.
      if (
        state.unwrappableIds.length === ids.length &&
        state.unwrappableIds.every((id, i) => id === ids[i])
      ) {
        return state
      }
      return { unwrappableIds: [...ids] }
    })
  },

  setDetections: (detections) => {
    const sorted = sortByDocumentOrder(detections, get().segmentOrder)
    set({
      detections: sorted,
      focusedId: headsOf(sorted)[0]?.id ?? null,
      undoStack: [],
      pendingMissedSelection: null,
      commitPanelOpen: false,
      editingReplacementId: null,
      unwrappableIds: [],
    })
  },

  setSessionId: (id) => {
    set({ sessionId: id })
  },

  appendDetection: (detection) => {
    set((state) => {
      if (state.detections.some((d) => d.id === detection.id)) {
        return { focusedId: detection.id }
      }
      return {
        detections: sortByDocumentOrder([...state.detections, detection], state.segmentOrder),
        focusedId: detection.id,
      }
    })
  },

  removeDetection: (id) => {
    set((state) => ({
      detections: state.detections.filter((d) => d.id !== id),
      focusedId: state.focusedId === id ? null : state.focusedId,
      undoStack: state.undoStack.filter((edit) => edit.id !== id),
      editingReplacementId: state.editingReplacementId === id ? null : state.editingReplacementId,
    }))
  },

  refreshDetections: (updates, previews) => {
    set((state) => {
      const byId = new Map(updates.map((u) => [u.id, u]))
      const detections = state.detections.map((d) => {
        const u = byId.get(d.id)
        if (u === undefined) return d
        return {
          ...d,
          segmentId: u.segmentId,
          start: u.start,
          end: u.end,
          text: u.text,
          groupId: u.groupId,
          groupIndex: u.groupIndex,
          groupText: u.groupText,
        }
      })
      const nextPreviews = { ...state.previews }
      for (const id of byId.keys()) {
        const preview = previews[id]
        if (preview !== undefined) nextPreviews[id] = preview
      }
      return {
        detections: sortByDocumentOrder(detections, state.segmentOrder),
        previews: nextPreviews,
        focusedId:
          state.focusedId === null ? null : (headOf(detections, state.focusedId)?.id ?? null),
      }
    })
  },

  setLastSyncError: (error) => {
    if (error === null) {
      set({ lastSyncError: null })
      return
    }
    if (typeof error === 'string') {
      set({ lastSyncError: { status: null, message: error } })
      return
    }
    set({ lastSyncError: error })
  },

  setCommitResult: (result) => {
    set({ commitResult: result })
  },

  setMappingStoreUnlocked: (unlocked) => {
    set({ mappingStoreUnlocked: unlocked })
  },

  setPreviews: (map) => {
    set({ previews: { ...map } })
  },

  setPreview: (id, preview) => {
    set((state) => {
      // A linked finding renders its replacement once, on the head; the
      // other pieces render empty — the same split the engine's previews use.
      const head = headOf(state.detections, id)
      if (head?.groupId === undefined) return { previews: { ...state.previews, [id]: preview } }
      const next = { ...state.previews }
      for (const m of membersOf(state.detections, id)) next[m.id] = m.id === head.id ? preview : ''
      return { previews: next }
    })
  },

  clearPreview: (id) => {
    set((state) => {
      if (!(id in state.previews)) return state
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(state.previews)) {
        if (k !== id) next[k] = v
      }
      return { previews: next }
    })
  },

  clear: () => {
    set({
      detections: [],
      focusedId: null,
      undoStack: [],
      pendingMissedSelection: null,
      commitPanelOpen: false,
      editingReplacementId: null,
      sessionId: null,
      lastSyncError: null,
      previews: {},
      commitResult: null,
      segmentOrder: [],
      unwrappableIds: [],
    })
  },

  setStatus: (id, status) => {
    set((state) => {
      // Deciding any piece of a linked finding decides every piece; the
      // undo entry is keyed by the head and restores the whole group.
      const head = headOf(state.detections, id)
      if (head === undefined) return state
      const members = new Set(membersOf(state.detections, id).map((d) => d.id))
      if (state.detections.every((d) => !members.has(d.id) || d.status === status)) return state
      return {
        detections: state.detections.map((d) => (members.has(d.id) ? { ...d, status } : d)),
        undoStack: [...state.undoStack, { kind: 'status', id: head.id, previous: head.status }],
      }
    })
  },

  setFocused: (id) => {
    set((state) => ({
      focusedId: id === null ? null : (headOf(state.detections, id)?.id ?? id),
    }))
  },

  focusNext: () => {
    const detections = headsOf(get().detections)
    const { focusedId } = get()
    if (detections.length === 0) return
    const currentIdx = detections.findIndex((d) => d.id === focusedId)
    const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % detections.length
    set({ focusedId: detections[nextIdx]?.id ?? null })
  },

  focusPrev: () => {
    const detections = headsOf(get().detections)
    const { focusedId } = get()
    if (detections.length === 0) return
    const currentIdx = detections.findIndex((d) => d.id === focusedId)
    const prevIdx =
      currentIdx === -1
        ? detections.length - 1
        : (currentIdx - 1 + detections.length) % detections.length
    set({ focusedId: detections[prevIdx]?.id ?? null })
  },

  focusNextPending: () => {
    const detections = headsOf(get().detections)
    const { focusedId } = get()
    if (detections.length === 0) return
    const currentIdx = detections.findIndex((d) => d.id === focusedId)
    // Walk the list once starting from the slot after the current
    // focus, wrapping. Skips the focused detection itself so a fresh
    // accept/reject doesn't immediately re-focus the just-decided
    // entry just because it's still in the list.
    const start = currentIdx === -1 ? 0 : currentIdx + 1
    for (let i = 0; i < detections.length; i++) {
      const idx = (start + i) % detections.length
      const candidate = detections[idx]
      if (candidate === undefined) continue
      if (candidate.id === focusedId) continue
      if (candidate.status === 'pending') {
        set({ focusedId: candidate.id })
        return
      }
    }
    // No pending detection left: leave focus on the just-decided one
    // so the user can see the verdict they applied.
  },

  undoLastDecision: () => {
    set((state) => {
      const last = state.undoStack[state.undoStack.length - 1]
      if (last === undefined) return state
      if (last.kind === 'status') {
        const members = new Set(membersOf(state.detections, last.id).map((d) => d.id))
        return {
          detections: state.detections.map((d) =>
            members.has(d.id) ? { ...d, status: last.previous } : d,
          ),
          undoStack: state.undoStack.slice(0, -1),
          focusedId: headOf(state.detections, last.id)?.id ?? last.id,
        }
      }
      // last.kind === 'user-add'
      const removedId = last.id
      const nextPreviews = Object.fromEntries(
        Object.entries(state.previews).filter(([k]) => k !== removedId),
      )
      return {
        detections: state.detections.filter((d) => d.id !== removedId),
        previews: nextPreviews,
        undoStack: state.undoStack.slice(0, -1),
        focusedId: null,
      }
    })
  },

  pushUserAddUndo: (entry) => {
    set((state) => ({
      undoStack: [...state.undoStack, entry],
    }))
  },

  setPendingMissedSelection: (value) => {
    set({ pendingMissedSelection: value })
  },

  addMissed: (span) => {
    const id = `user:${span.locator.segmentId}:${String(span.locator.start)}-${String(span.locator.end)}`
    set((state) => {
      if (state.detections.some((d) => d.id === id)) {
        return { focusedId: id }
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
        detections: sortByDocumentOrder([...state.detections, detection], state.segmentOrder),
        focusedId: id,
      }
    })
    return id
  },

  setOperator: (id, operator) => {
    set((state) => {
      const members = new Set(membersOf(state.detections, id).map((d) => d.id))
      return {
        detections: state.detections.map((d) => (members.has(d.id) ? { ...d, operator } : d)),
      }
    })
  },

  setCustomReplacement: (id, replacement) => {
    set((state) => {
      const members = new Set(membersOf(state.detections, id).map((d) => d.id))
      return {
        detections: state.detections.map((d) =>
          members.has(d.id) ? { ...d, customReplacement: replacement ?? undefined } : d,
        ),
      }
    })
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
