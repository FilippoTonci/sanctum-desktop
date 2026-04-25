import type { ReactElement } from 'react'
import type { SanctumStatus } from '../sanctum'

interface SplashProps {
  readonly status: SanctumStatus
}

export function Splash({ status }: SplashProps): ReactElement {
  return (
    <section className="splash" aria-live="polite" aria-busy={status.state !== 'error'}>
      <div className="splash-spinner" aria-hidden={status.state !== 'waiting-for-health'} />
      <p className="splash-message">{splashMessage(status)}</p>
      {status.state === 'error' ? (
        <p className="splash-error-detail">
          The desktop app cannot reach the Sanctum backend. Try restarting the app; if the problem
          persists, file an issue with the logs from Help → Export diagnostics.
        </p>
      ) : null}
    </section>
  )
}

function splashMessage(status: SanctumStatus): string {
  switch (status.state) {
    case 'idle':
      return 'Waiting for backend…'
    case 'starting':
    case 'waiting-for-health':
      return status.message
    case 'ready':
      return 'Ready.'
    case 'error':
      return `Could not start the Sanctum backend: ${status.message}`
  }
}
