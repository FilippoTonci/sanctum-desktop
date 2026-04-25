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

export interface SaveDialogOptions {
  readonly defaultPath?: string
  readonly title?: string
}

export interface SaveDialogResult {
  readonly canceled: boolean
  readonly filePath: string | null
}

export type NerBackend = 'spacy' | 'gliner'

export interface AppSettings {
  readonly nerBackend: NerBackend
  readonly scoreThreshold: number
  readonly defaultOperator: string
}

export interface SanctumApi {
  getStatus(): Promise<SanctumStatus>
  onStatusChange(listener: (status: SanctumStatus) => void): () => void
  /**
   * Absolute filesystem path for a dropped File, or '' when unavailable
   * (renderer-synthesised test files, browsers without webUtils, etc.).
   */
  getFilePath(file: File): string
  showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogResult>
  revealInFolder(path: string): Promise<void>
  getMappingStorePath(): Promise<string>
  getSettings(): Promise<AppSettings | null>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings | null>
}

declare global {
  interface Window {
    // Optional because the renderer can also be loaded directly in a plain
    // browser (e.g. Vite dev server hit by Playwright for visual iteration)
    // where the Electron preload bridge is not present.
    readonly sanctum?: SanctumApi
  }
}
