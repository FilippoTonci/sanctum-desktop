export interface SanctumApi {
  readonly ready: boolean
  readonly baseUrl?: string
  readonly token?: string
}

declare global {
  interface Window {
    readonly sanctum: SanctumApi
  }
}
