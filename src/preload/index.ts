import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

const STATUS_CHANNEL = 'sanctum:status-change'
const STATUS_GET_CHANNEL = 'sanctum:get-status'
const SAVE_DIALOG_CHANNEL = 'sanctum:show-save-dialog'
const REVEAL_IN_FOLDER_CHANNEL = 'sanctum:reveal-in-folder'
const MAPPING_STORE_PATH_CHANNEL = 'sanctum:get-mapping-store-path'
const SETTINGS_GET_CHANNEL = 'sanctum:get-settings'
const SETTINGS_UPDATE_CHANNEL = 'sanctum:update-settings'

export type NerBackend = 'spacy' | 'gliner'

export interface AppSettings {
  readonly nerBackend: NerBackend
  readonly scoreThreshold: number
  readonly defaultOperator: string
}

export interface SaveDialogOptions {
  readonly defaultPath?: string
  readonly title?: string
}

export interface SaveDialogResult {
  readonly canceled: boolean
  readonly filePath: string | null
}

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
  /**
   * Resolve a File from a drop / file-input event to its absolute path
   * on disk. Returns the empty string when the path is unavailable —
   * Electron's `webUtils.getPathForFile` is not guaranteed to find one
   * for files synthesised in renderer code (e.g. test fixtures built
   * via `new File([...], name)`). Backend `POST /review-sessions`
   * requires a server-readable absolute path, so a missing path means
   * the renderer must fall back to its standalone-mode behaviour.
   */
  getFilePath(file: File): string
  /**
   * Open the OS save-as dialog and return the user's chosen path
   * (or canceled=true). Used by the commit panel to pick where the
   * anonymized output should land.
   */
  showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogResult>
  /**
   * Open the OS file manager focused on the given file. Used by the
   * post-commit success state to let the reviewer find the output.
   */
  revealInFolder(path: string): Promise<void>
  /**
   * Default on-disk location of the encrypted pseudonymize mapping
   * store. Settings (WS5-7) will let the user override this; until
   * then it's the well-known per-user path so the unlock UX doesn't
   * have to ask the user to type a filesystem path.
   */
  getMappingStorePath(): Promise<string>
  /**
   * Read the current app settings (NLP tier, score threshold, default
   * operator). Returns null only when the main process hasn't finished
   * its app-ready boot — practically never seen by the renderer.
   */
  getSettings(): Promise<AppSettings | null>
  /**
   * Persist a settings patch and trigger a sidecar respawn so the new
   * env lands on the Python process. Returns the merged settings.
   */
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings | null>
}

const api: SanctumApi = {
  async getStatus() {
    return (await ipcRenderer.invoke(STATUS_GET_CHANNEL)) as SanctumStatus
  },
  onStatusChange(listener) {
    const subscription = (_event: IpcRendererEvent, status: SanctumStatus): void => {
      listener(status)
    }
    ipcRenderer.on(STATUS_CHANNEL, subscription)
    return () => {
      ipcRenderer.off(STATUS_CHANNEL, subscription)
    }
  },
  getFilePath(file) {
    return webUtils.getPathForFile(file)
  },
  async showSaveDialog(options) {
    return (await ipcRenderer.invoke(SAVE_DIALOG_CHANNEL, options)) as SaveDialogResult
  },
  async revealInFolder(path) {
    await ipcRenderer.invoke(REVEAL_IN_FOLDER_CHANNEL, path)
  },
  async getMappingStorePath() {
    return (await ipcRenderer.invoke(MAPPING_STORE_PATH_CHANNEL)) as string
  },
  async getSettings() {
    return (await ipcRenderer.invoke(SETTINGS_GET_CHANNEL)) as AppSettings | null
  },
  async updateSettings(patch) {
    return (await ipcRenderer.invoke(SETTINGS_UPDATE_CHANNEL, patch)) as AppSettings | null
  },
}

contextBridge.exposeInMainWorld('sanctum', api)
