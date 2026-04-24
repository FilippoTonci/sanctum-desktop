export interface HealthResponse {
  readonly status: string
  readonly sanctum_commit?: string
  readonly openapi_digest?: string
  readonly mapping_store_unlocked?: boolean
}

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

export interface SanctumApi {
  getStatus(): Promise<SanctumStatus>
  onStatusChange(listener: (status: SanctumStatus) => void): () => void
}

declare global {
  interface Window {
    readonly sanctum: SanctumApi
  }
}
