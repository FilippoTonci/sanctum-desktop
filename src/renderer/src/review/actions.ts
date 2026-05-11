/**
 * High-level review actions — the layer between UI events
 * (keyboard map, tooltip buttons, mark-missed flow) and the
 * Zustand store + backend HTTP client.
 *
 * Two implementations:
 *
 * - `localActions` — fake mode. Calls store mutators directly.
 *   Identical behavior to WS4: every change is in-memory only.
 *
 * - `syncedActions(client, sessionId, ...)` — real mode. Optimistically
 *   updates the store, then PATCH/POST/DELETEs the backend so a
 *   later resume sees the same decisions. Errors revert the optimistic
 *   change and surface via the store's `lastSyncError` slot for slice
 *   8's typed error component to render.
 *
 * The interface is fire-and-forget (`void` return) on purpose: the
 * keyboard handler is synchronous and needs to dispatch without
 * awaiting. Latency-sensitive UX (e.g. mark-missed showing the
 * highlight immediately) reads its feedback from the store, not from
 * an awaited promise.
 */

import type { SessionsClient } from '../api/sessions'
import { ApiError, type DecisionWithPreviewResponse } from '../api/types'
import { useReviewStore } from './store'
import type { Detection, OperatorName } from './types'
import type { MissedSpan } from './store'

export interface ReviewActions {
  accept(id: string): void
  reject(id: string): void
  setOperator(id: string, operator: OperatorName): void
  setCustomReplacement(id: string, replacement: string | null): void
  addMissed(span: MissedSpan): void
  undoLastDecision(): void
}

export const localActions: ReviewActions = {
  accept(id) {
    useReviewStore.getState().setStatus(id, 'accepted')
  },
  reject(id) {
    useReviewStore.getState().setStatus(id, 'rejected')
  },
  setOperator(id, operator) {
    useReviewStore.getState().setOperator(id, operator)
  },
  setCustomReplacement(id, replacement) {
    useReviewStore.getState().setCustomReplacement(id, replacement)
  },
  addMissed(span) {
    useReviewStore.getState().addMissed(span)
  },
  undoLastDecision() {
    useReviewStore.getState().undoLastDecision()
  },
}

export interface SyncedActionsContext {
  readonly client: SessionsClient
  readonly sessionId: string
}

/**
 * Build actions that mirror every store mutation onto the backend.
 *
 * The wrapper pattern is: optimistic store update first; fire the
 * network call; on error, undo the optimistic update by replaying
 * the stored "previous" snapshot. The store already keeps an
 * undoStack of (id, previous-status) pairs which we lean on for
 * accept/reject; operator + custom-replacement edits read the prior
 * value from the live store before mutating.
 *
 * Out-of-scope edges (documented for slice 5+):
 *
 * - User-added decisions don't have a backend PATCH endpoint.
 *   Accept on a user-added is a no-op (it's already "accepted" by
 *   virtue of existing); reject DELETEs the user-added decision
 *   server-side. setOperator / setCustomReplacement on a user-
 *   added stay local-only because the backend has no slot for
 *   updating them.
 * - Undo back to 'pending' (un-deciding a previously-decided
 *   proposal) requires a backend DELETE for proposal decisions
 *   that doesn't exist yet. The local store still reverts; on
 *   resume the backend will still show the prior verdict. Tracked
 *   as a follow-up — see CHANGELOG.
 */
export function syncedActions(ctx: SyncedActionsContext): ReviewActions {
  const { client, sessionId } = ctx

  const detectionById = (id: string): Detection | undefined =>
    useReviewStore.getState().detections.find((d) => d.id === id)

  const isUserAdded = (id: string): boolean => id.startsWith('user:')

  const reportError = (action: string, err: unknown): void => {
    const status = err instanceof ApiError ? err.status : null
    const message =
      err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err)
    useReviewStore.getState().setLastSyncError({ status, message: `${action}: ${message}` })
  }

  const patchProposal = (
    detection: Detection,
    overrides: Partial<{
      status: 'accept' | 'reject'
      operator: OperatorName | null
      customReplacement: string | null
    }>,
  ): Promise<DecisionWithPreviewResponse> => {
    const status: 'accept' | 'reject' =
      overrides.status ??
      (detection.status === 'accepted'
        ? 'accept'
        : detection.status === 'rejected'
          ? 'reject'
          : 'accept')
    const operator = 'operator' in overrides ? overrides.operator : (detection.operator ?? null)
    const customReplacement =
      'customReplacement' in overrides
        ? overrides.customReplacement
        : (detection.customReplacement ?? null)
    return client.patchDecision(sessionId, detection.id, {
      status,
      operator,
      custom_replacement: customReplacement,
    })
  }

  const recordPreview = (id: string, response: DecisionWithPreviewResponse): void => {
    useReviewStore.getState().setPreview(id, response.preview)
  }

  return {
    accept(id) {
      const detection = detectionById(id)
      if (detection === undefined) return
      const previous = detection.status

      // Optimistic local flip first so the UI is responsive.
      useReviewStore.getState().setStatus(id, 'accepted')

      if (isUserAdded(id)) {
        // User-added detections are accepted-by-default on the backend;
        // nothing to PATCH. The store flip is sufficient.
        return
      }

      void (async () => {
        try {
          const response = await patchProposal(detection, { status: 'accept' })
          recordPreview(id, response)
        } catch (err) {
          useReviewStore.getState().setStatus(id, previous)
          reportError('accept', err)
        }
      })()
    },

    reject(id) {
      const detection = detectionById(id)
      if (detection === undefined) return
      const previous = detection.status

      useReviewStore.getState().setStatus(id, 'rejected')

      if (isUserAdded(id)) {
        // Reject-on-user-added means "remove this user-added decision".
        const uaId = id.slice('user:'.length)
        void (async () => {
          try {
            await client.deleteUserAdded(sessionId, uaId)
            useReviewStore.getState().removeDetection(id)
            useReviewStore.getState().clearPreview(id)
          } catch (err) {
            useReviewStore.getState().setStatus(id, previous)
            reportError('reject (user-added)', err)
          }
        })()
        return
      }

      void (async () => {
        try {
          const response = await patchProposal(detection, { status: 'reject' })
          recordPreview(id, response)
        } catch (err) {
          useReviewStore.getState().setStatus(id, previous)
          reportError('reject', err)
        }
      })()
    },

    setOperator(id, operator) {
      const detection = detectionById(id)
      if (detection === undefined) return
      const previous = detection.operator
      useReviewStore.getState().setOperator(id, operator)

      // Backend has no PATCH endpoint for user-added; keep local-only.
      if (isUserAdded(id)) return
      // No decision exists for a still-pending proposal; the operator
      // override gets sent with the eventual accept/reject PATCH.
      if (detection.status === 'pending') return

      void (async () => {
        try {
          const response = await patchProposal(detection, { operator })
          recordPreview(id, response)
        } catch (err) {
          if (previous === undefined) {
            // Roll back by clearing the operator (back to default).
            // setOperator can't accept undefined; fall back to the session
            // default by deleting via a setOperator call to the original.
            // The store treats undefined → 'falls back to default' but
            // the action signature requires OperatorName — restore via a
            // direct store mutation here.
            useReviewStore.setState((s) => ({
              detections: s.detections.map((d) =>
                d.id === id ? { ...d, operator: undefined } : d,
              ),
            }))
          } else {
            useReviewStore.getState().setOperator(id, previous)
          }
          reportError('setOperator', err)
        }
      })()
    },

    setCustomReplacement(id, replacement) {
      const detection = detectionById(id)
      if (detection === undefined) return
      const previous = detection.customReplacement ?? null
      useReviewStore.getState().setCustomReplacement(id, replacement)

      if (isUserAdded(id)) return
      if (detection.status === 'pending') return

      void (async () => {
        try {
          const response = await patchProposal(detection, { customReplacement: replacement })
          recordPreview(id, response)
        } catch (err) {
          useReviewStore.getState().setCustomReplacement(id, previous)
          reportError('setCustomReplacement', err)
        }
      })()
    },

    addMissed(span) {
      // Real mode is POST-then-add: the user sees a brief delay between
      // clicking the button (or pressing m) and the highlight appearing,
      // but accept/reject shortcuts pressed immediately afterwards land on
      // a real backend-known id rather than a synthetic one that would 404.
      //
      // Clear focus while the POST is in flight so the user doesn't see
      // the prior (often already-accepted) detection appear to "stay
      // selected" through the round-trip — issue #18. On POST success,
      // appendDetection below moves focus onto the freshly-minted
      // user-added detection so it's the one the reviewer can immediately
      // tweak (operator, custom replacement, …).
      useReviewStore.getState().setFocused(null)
      void (async () => {
        try {
          const response = await client.addUserAdded(sessionId, {
            segment_anchor: span.locator.segmentId,
            entity_type: 'USER_ADDED',
            original: span.text,
            start: span.locator.start,
            end: span.locator.end,
          })
          if (response.decision.kind !== 'user_added') return
          // Backend drops any model proposal whose char range overlapped
          // the new UA span (sanctum#31). Mirror the cascade locally so
          // the listing matches what a refetch would show.
          const removedIds = response.removed_proposal_ids ?? []
          for (const id of removedIds) {
            useReviewStore.getState().removeDetection(id)
            useReviewStore.getState().clearPreview(id)
          }
          const ua = response.decision
          const detectionId = `user:${ua.id}`
          useReviewStore.getState().appendDetection({
            id: detectionId,
            segmentId: ua.segment_anchor,
            start: ua.start,
            end: ua.end,
            text: ua.original,
            entityType: 'USER_ADDED',
            status: 'accepted',
          })
          useReviewStore.getState().setPreview(detectionId, response.preview)
          useReviewStore.getState().pushUserAddUndo({
            kind: 'user-add',
            id: detectionId,
            segmentId: ua.segment_anchor,
            start: ua.start,
            end: ua.end,
            text: ua.original,
            entityType: 'USER_ADDED',
            preview: response.preview,
          })
        } catch (err) {
          reportError('addMissed', err)
        }
      })()
    },

    undoLastDecision() {
      const state = useReviewStore.getState()
      const last = state.undoStack[state.undoStack.length - 1]
      if (last === undefined) return

      // Snapshot the detection before the local revert pops the entry and
      // (for a user-add) removes the detection.
      const detection = detectionById(last.id)

      // Local revert always runs first — the user expects undo to be snappy.
      // The store's undoLastDecision applies the local change appropriate
      // to the entry's kind and pops the stack.
      useReviewStore.getState().undoLastDecision()

      if (last.kind === 'status') {
        if (detection === undefined) return
        if (isUserAdded(last.id)) return
        if (last.previous === 'pending') {
          // Backend has no DELETE for proposal decisions yet; we leave the
          // server-side verdict in place. Documented gap (unchanged).
          return
        }
        const reverted: Detection = { ...detection, status: last.previous }
        void (async () => {
          try {
            const response = await patchProposal(reverted, {
              status: last.previous === 'accepted' ? 'accept' : 'reject',
            })
            recordPreview(last.id, response)
          } catch (err) {
            useReviewStore.getState().setStatus(last.id, detection.status)
            reportError('undo', err)
          }
        })()
        return
      }

      // last.kind === 'user-add' — DELETE on the backend, restore on failure.
      const uaId = last.id.slice('user:'.length)
      void (async () => {
        try {
          await client.deleteUserAdded(sessionId, uaId)
        } catch (err) {
          useReviewStore.getState().appendDetection({
            id: last.id,
            segmentId: last.segmentId,
            start: last.start,
            end: last.end,
            text: last.text,
            entityType: last.entityType,
            status: 'accepted',
          })
          if (last.preview !== undefined) {
            useReviewStore.getState().setPreview(last.id, last.preview)
          }
          reportError('undo (user-added)', err)
        }
      })()
    },
  }
}
