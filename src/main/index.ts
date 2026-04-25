import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pollHealth } from './health'
import { spawnSidecar, type SidecarHandle } from './sidecar'
import { StatusBus, toPublicStatus } from './status'

const APP_URL_ALLOWLIST = new Set<string>(['https://github.com/FilippoTonci/sanctum'])
const STATUS_CHANNEL = 'sanctum:status-change'
const STATUS_GET_CHANNEL = 'sanctum:get-status'
const SAVE_DIALOG_CHANNEL = 'sanctum:show-save-dialog'
const REVEAL_IN_FOLDER_CHANNEL = 'sanctum:reveal-in-folder'
const MAPPING_STORE_PATH_CHANNEL = 'sanctum:get-mapping-store-path'

interface SaveDialogRequest {
  readonly defaultPath?: string
  readonly title?: string
}

interface SaveDialogResult {
  readonly canceled: boolean
  readonly filePath: string | null
}

const statusBus = new StatusBus()
let sidecar: SidecarHandle | null = null

function broadcastStatus(): void {
  const payload = toPublicStatus(statusBus.status)
  for (const win of BrowserWindow.getAllWindows()) {
    const target: WebContents = win.webContents
    target.send(STATUS_CHANNEL, payload)
  }
}

statusBus.on('change', broadcastStatus)

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (APP_URL_ALLOWLIST.has(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl !== undefined && devUrl !== '') {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function startSidecar(): Promise<void> {
  statusBus.set({ state: 'starting', message: 'Spawning Sanctum backend…' })

  try {
    sidecar = await spawnSidecar()
    statusBus.set({
      state: 'waiting-for-health',
      baseUrl: sidecar.baseUrl,
      message: 'Loading NLP models…',
    })

    const health = await pollHealth({ baseUrl: sidecar.baseUrl, token: sidecar.token })

    statusBus.set({
      state: 'ready',
      baseUrl: sidecar.baseUrl,
      token: sidecar.token,
      health,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    statusBus.set({ state: 'error', message })
    if (sidecar !== null) {
      await sidecar.kill().catch(() => undefined)
      sidecar = null
    }
  }
}

ipcMain.handle(STATUS_GET_CHANNEL, () => toPublicStatus(statusBus.status))

ipcMain.handle(
  SAVE_DIALOG_CHANNEL,
  async (event, request: SaveDialogRequest): Promise<SaveDialogResult> => {
    // Anchor the dialog on the BrowserWindow that issued the request so
    // it modal-stacks over the right surface (multi-window is not in
    // scope today, but the call site is the same).
    const win = BrowserWindow.fromWebContents(event.sender)
    const result =
      win === null
        ? await dialog.showSaveDialog({
            defaultPath: request.defaultPath,
            title: request.title,
          })
        : await dialog.showSaveDialog(win, {
            defaultPath: request.defaultPath,
            title: request.title,
          })
    return {
      canceled: result.canceled,
      // Electron types `filePath` as a non-optional string but populates
      // it with the empty string on cancel; normalise to null so the
      // renderer sees one shape.
      filePath: result.canceled || result.filePath === '' ? null : result.filePath,
    }
  },
)

ipcMain.handle(REVEAL_IN_FOLDER_CHANNEL, (_event, path: string) => {
  // shell.showItemInFolder is sync and returns void; expose it as a
  // promise-returning IPC for symmetry with the rest of the surface.
  shell.showItemInFolder(path)
})

ipcMain.handle(MAPPING_STORE_PATH_CHANNEL, (): string => {
  // Default location matches the backend's CLI default. WS5-7 (settings)
  // will let the user override this via env / config; for now it's
  // hard-wired so the mapping-unlock UX doesn't have to ask the user
  // to type the path.
  return join(homedir(), '.sanctum', 'mapping-store.bin')
})

void app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  if (process.env.SANCTUM_SKIP_SIDECAR !== '1') {
    void startSidecar()
  } else {
    statusBus.set({ state: 'idle' })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Quit orchestration. Electron's `before-quit` listener is synchronous, so
 * we `preventDefault`, run the async sidecar shutdown ourselves, then
 * `app.quit()` re-enters this handler with `quitting=true` and the default
 * path runs. If SIGTERM → SIGKILL still leaves the sidecar alive, prompt
 * the user: Force Quit hard-exits the app (orphaning the Python process);
 * Cancel leaves the app running so the user can save work or file a bug.
 */
let quitting = false

app.on('before-quit', (event) => {
  if (quitting) return
  if (sidecar === null) return

  event.preventDefault()
  quitting = true

  const handle = sidecar
  sidecar = null

  void (async () => {
    try {
      await handle.kill()
      app.quit()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: 'Sanctum backend did not shut down',
        message: 'The Sanctum backend did not exit after SIGTERM → SIGKILL.',
        detail:
          'Force Quit will exit Sanctum Desktop anyway. The Python process may remain ' +
          'in your process list until the OS cleans it up.\n\n' +
          `Reason: ${message}`,
        buttons: ['Force Quit', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      })

      if (result.response === 0) {
        app.exit(1)
      } else {
        quitting = false
      }
    }
  })()
})
