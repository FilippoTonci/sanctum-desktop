import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react'
import type { SessionsClient } from '../api/sessions'
import { localActions, syncedActions, type ReviewActions } from './actions'

/**
 * Components consume `useReviewActions()` to dispatch verdicts /
 * operator changes / mark-missed / undo without caring whether they're
 * in fake (no backend) or synced (real backend) mode. App.tsx provides
 * the right implementation via this context based on the current
 * session's client + id.
 */
const ReviewActionsContext = createContext<ReviewActions>(localActions)

interface ReviewActionsProviderProps {
  readonly client: SessionsClient | null
  readonly sessionId: string | null
  readonly children: ReactNode
}

export function ReviewActionsProvider({
  client,
  sessionId,
  children,
}: ReviewActionsProviderProps): ReactElement {
  const actions = useMemo<ReviewActions>(() => {
    if (client === null || sessionId === null) return localActions
    return syncedActions({ client, sessionId })
  }, [client, sessionId])

  return <ReviewActionsContext.Provider value={actions}>{children}</ReviewActionsContext.Provider>
}

export function useReviewActions(): ReviewActions {
  return useContext(ReviewActionsContext)
}
