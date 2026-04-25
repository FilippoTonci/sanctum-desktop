import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

const STATUS_CHANNEL = 'sanctum:status-change'
const STATUS_GET_CHANNEL = 'sanctum:get-status'

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
}

contextBridge.exposeInMainWorld('sanctum', api)
