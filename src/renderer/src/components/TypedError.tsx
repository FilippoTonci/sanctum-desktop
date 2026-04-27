import { type ReactElement } from 'react'
import { ApiError } from '../api/types'

interface TypedErrorProps {
  /** Error to render. ApiError carries .status; anything else is generic. */
  readonly error: unknown
  /** Optional retry hook — when provided, the rendered card adds a Retry button. */
  readonly onRetry?: () => void
  /** Optional dismiss hook — when provided, the rendered card adds a Dismiss button. */
  readonly onDismiss?: () => void
}

interface ErrorCopy {
  readonly title: string
  readonly hint: string
}

/**
 * Single user-facing component that turns an unknown error (typically an
 * `ApiError` from the sessions / mapping clients) into a friendly card
 * with status-specific copy. Centralising the messaging here means the
 * SyncErrorToast / AnalysisBanner / CommitPanel error blocks all speak
 * the same language; one place to update if a status code changes
 * meaning on the backend.
 *
 * Status codes covered explicitly (per pre-WS5 reflection point #5):
 *
 *   409  the session is no longer open (committed or abandoned)
 *   413  the dropped file exceeds the sidecar's max upload size
 *   415  the dropped file's format is not supported
 *   503  the sidecar is unreachable / unconfigured / loading
 *
 * Anything else falls through to a generic "Something went wrong" with
 * the raw message — better than swallowing it.
 */
export function TypedError({ error, onRetry, onDismiss }: TypedErrorProps): ReactElement {
  const status = error instanceof ApiError ? error.status : null
  const message = errorMessage(error)
  const copy = describeStatus(status)

  return (
    <div className="typed-error" role="alert" data-status={status ?? 'generic'}>
      <div className="typed-error-content">
        <strong className="typed-error-title">{copy.title}</strong>
        <span className="typed-error-message">{message}</span>
        <span className="typed-error-hint">{copy.hint}</span>
      </div>
      <div className="typed-error-actions">
        {onRetry !== undefined ? (
          <button type="button" className="typed-error-retry" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {onDismiss !== undefined ? (
          <button type="button" className="typed-error-dismiss" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function describeStatus(status: number | null): ErrorCopy {
  switch (status) {
    case 409:
      return {
        title: 'Session is no longer open',
        hint: 'Another client committed or abandoned this session — close it and start a new one.',
      }
    case 413:
      return {
        title: 'File too large',
        hint: 'The Sanctum sidecar refused this document because it exceeds the upload limit.',
      }
    case 415:
      return {
        title: 'Unsupported document format',
        hint: 'Only .docx documents are supported in the current Sanctum release.',
      }
    case 503:
      return {
        title: 'Sanctum backend unavailable',
        hint: 'The sidecar is starting up, restarting, or unreachable. Try again in a moment.',
      }
    case null:
      return {
        title: 'Something went wrong',
        hint: 'See the message above. If the problem persists, restart the app or file an issue.',
      }
    default:
      return {
        title: `Backend returned HTTP ${String(status)}`,
        hint: 'See the message above. If the problem persists, restart the app or file an issue.',
      }
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error.'
}
