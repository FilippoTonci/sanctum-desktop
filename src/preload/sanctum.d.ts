import type { SanctumApi } from './index'

declare global {
  interface Window {
    readonly sanctum: SanctumApi
  }
}

export {}
