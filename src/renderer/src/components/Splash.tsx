import type { ReactElement } from 'react'
import type { SanctumStatus } from '../sanctum'

interface SplashProps {
  readonly status: SanctumStatus
}

/**
 * Non-blocking engine status strip, shown at the top of the main area
 * whenever the local detection engine is not ready (first boot, restart
 * after a settings change, or a failure). The app stays usable around it.
 */
export function Splash({ status }: SplashProps): ReactElement {
  const isError = status.state === 'error'
  return (
    <section
      className={`engine-strip${isError ? ' is-error' : ''}`}
      aria-live="polite"
      aria-busy={!isError}
    >
      {isError ? null : <span className="spinner" aria-hidden="true" />}
      <p className="engine-strip-message">{splashMessage(status)}</p>
      {isError ? (
        <p className="engine-strip-detail">
          The desktop app cannot reach its local detection engine. Quit and reopen Sanctum; if the
          engine still does not start, reinstall the app.
        </p>
      ) : null}
    </section>
  )
}

function splashMessage(status: SanctumStatus): string {
  switch (status.state) {
    case 'idle':
      return 'Starting the detection engine…'
    case 'starting':
    case 'waiting-for-health':
      return status.message
    case 'ready':
      return 'Ready.'
    case 'error':
      return `The detection engine could not start: ${status.message}`
  }
}

/** One-word engine state for the sidebar's trust line. */
export function engineLabel(status: SanctumStatus): string {
  switch (status.state) {
    case 'ready':
      return 'Offline, on this computer'
    case 'error':
      return 'Engine stopped'
    case 'idle':
    case 'starting':
    case 'waiting-for-health':
      return 'Engine starting…'
  }
}
