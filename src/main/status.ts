import { EventEmitter } from 'node:events'
import type { HealthResponse } from './health'

export type SanctumStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'starting'; readonly message: string }
  | { readonly state: 'waiting-for-health'; readonly baseUrl: string; readonly message: string }
  | {
      readonly state: 'ready'
      readonly baseUrl: string
      readonly token: string
      readonly health: HealthResponse
    }
  | { readonly state: 'error'; readonly message: string }

/**
 * Renderer-safe projection of `SanctumStatus`. `token` is intentionally
 * stripped from every non-ready state so the renderer only sees it once
 * the backend is healthy.
 */
export type PublicStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'starting'; readonly message: string }
  | { readonly state: 'waiting-for-health'; readonly baseUrl: string; readonly message: string }
  | {
      readonly state: 'ready'
      readonly baseUrl: string
      readonly token: string
      readonly health: HealthResponse
    }
  | { readonly state: 'error'; readonly message: string }

export function toPublicStatus(status: SanctumStatus): PublicStatus {
  return status
}

/**
 * In-process status bus. Main publishes here; the IPC bridge in
 * `src/main/index.ts` forwards changes to all renderer WebContents.
 */
export class StatusBus extends EventEmitter {
  private current: SanctumStatus = { state: 'idle' }

  get status(): SanctumStatus {
    return this.current
  }

  set(next: SanctumStatus): void {
    this.current = next
    this.emit('change', next)
  }
}
