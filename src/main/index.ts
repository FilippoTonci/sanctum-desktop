import { app, BrowserWindow, dialog, ipcMain, session, shell, type WebContents } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pollHealth } from './health'
import { SettingsStore, settingsToEnv, type AppSettings } from './settings'
import { spawnSidecar, type SidecarHandle } from './sidecar'
import { StatusBus, toPublicStatus } from './status'

const APP_URL_ALLOWLIST = new Set<string>(['https://github.com/FilippoTonci/sanctum'])
const STATUS_CHANNEL = 'sanctum:status-change'
const STATUS_GET_CHANNEL = 'sanctum:get-status'
const SAVE_DIALOG_CHANNEL = 'sanctum:show-save-dialog'
const REVEAL_IN_FOLDER_CHANNEL = 'sanctum:reveal-in-folder'
const MAPPING_STORE_PATH_CHANNEL = 'sanctum:get-mapping-store-path'
const SETTINGS_GET_CHANNEL = 'sanctum:get-settings'
const SETTINGS_UPDATE_CHANNEL = 'sanctum:update-settings'

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
let settingsStore: SettingsStore | null = null

function broadcastStatus(): void {
  const payload = toPublicStatus(statusBus.status)
  for (const win of BrowserWindow.getAllWindows()) {
    const target: WebContents = win.webContents
    target.send(STATUS_CHANNEL, payload)
  }
}

statusBus.on('change', broadcastStatus)

function resolveIconPath(): string {
  // Dev: __dirname is out/main/, so two levels up → project root → resources/icon.png.
  // Packaged: copied via electron-builder extraResources to resourcesPath/icon.png.
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    icon: resolveIconPath(),
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
    const envOverrides = settingsStore !== null ? settingsToEnv(settingsStore.read()) : undefined
    sidecar = await spawnSidecar({ envOverrides })
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

/**
 * Tear down the running sidecar and start a fresh one. Used when
 * settings change so the new env (NLP tier, score threshold, default
 * operator) lands on the sidecar process. The renderer's existing
 * splash UX handles the transient 'starting' / 'waiting-for-health'
 * states for free.
 */
async function respawnSidecar(): Promise<void> {
  if (sidecar !== null) {
    const handle = sidecar
    sidecar = null
    await handle.kill().catch(() => undefined)
  }
  await startSidecar()
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

ipcMain.handle(SETTINGS_GET_CHANNEL, (): AppSettings | null => {
  return settingsStore?.read() ?? null
})

ipcMain.handle(
  SETTINGS_UPDATE_CHANNEL,
  async (_event, patch: Partial<AppSettings>): Promise<AppSettings | null> => {
    if (settingsStore === null) return null
    const next = await settingsStore.update(patch)
    // Respawn so the new env lands on the sidecar. Don't block the
    // IPC response on the full ready handshake — the renderer
    // observes the status bus directly and surfaces the transient
    // 'starting' / 'waiting-for-health' states via Splash.
    void respawnSidecar()
    return next
  },
)

/**
 * In dev the renderer is served by Vite at http://localhost:5173 and the
 * sidecar binds to 127.0.0.1:<dynamic-port>. Two CORS-related problems
 * appear that production doesn't have (file:// renderer sends no Origin
 * and isn't CORS-checked):
 *
 * 1. The sidecar's Flask before_request guard rejects any cross-origin
 *    request whose Origin isn't in its bind-address allowlist. We strip
 *    the Origin header on outbound requests so the guard's
 *    `if origin is not None` short-circuit kicks in.
 *
 * 2. The Authorization: Bearer header makes our POST a non-simple
 *    cross-origin request, so the browser sends an OPTIONS preflight.
 *    The sidecar answers 200 but without Access-Control-Allow-* reply
 *    headers, so the browser blocks the follow-up POST. We inject the
 *    allow headers on inbound responses from the sidecar.
 *
 * Bearer-token auth still gates every request; the airgap webRequest
 * filter (when it lands in WS6) will still cap destinations at
 * 127.0.0.1. Production bypasses both of these entirely.
 */
function installDevCorsShim(): void {
  if (process.env.ELECTRON_DEV !== '1') return
  const wr = session.defaultSession.webRequest

  wr.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    delete headers.Origin
    delete headers.origin
    callback({ requestHeaders: headers })
  })

  wr.onHeadersReceived({ urls: ['http://127.0.0.1:*/*'] }, (details, callback) => {
    const responseHeaders = { ...(details.responseHeaders ?? {}) }
    responseHeaders['Access-Control-Allow-Origin'] = ['*']
    responseHeaders['Access-Control-Allow-Methods'] = [
      'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
    ]
    responseHeaders['Access-Control-Allow-Headers'] = ['Authorization, Content-Type']
    callback({ responseHeaders })
  })
}

void app.whenReady().then(() => {
  settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'))

  installDevCorsShim()
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
