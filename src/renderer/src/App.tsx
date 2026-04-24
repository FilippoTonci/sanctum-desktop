import { useEffect, useState, type ReactElement } from 'react'
import { Splash } from './components/Splash'
import type { SanctumStatus } from './sanctum'

export function App(): ReactElement {
  const [status, setStatus] = useState<SanctumStatus>({ state: 'idle' })

  useEffect(() => {
    let active = true

    void window.sanctum.getStatus().then((current) => {
      if (active) setStatus(current)
    })

    const unsubscribe = window.sanctum.onStatusChange((next) => {
      if (active) setStatus(next)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <main className="shell">
      <header>
        <h1>Sanctum Desktop</h1>
        <p className="tagline">Local-first document anonymization — coming soon.</p>
      </header>
      {status.state === 'ready' ? <ReadyBody /> : <Splash status={status} />}
    </main>
  )
}

function ReadyBody(): ReactElement {
  return (
    <section className="status" aria-live="polite">
      <p>
        Sanctum backend is ready. The review surface arrives in WS4; drag-and-drop intake and
        mapping-store management come with WS5.
      </p>
    </section>
  )
}
