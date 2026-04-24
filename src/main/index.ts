import { app, BrowserWindow, ipcMain, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import { pollHealth } from './health'
import { spawnSidecar, type SidecarHandle } from './sidecar'
import { StatusBus, toPublicStatus } from './status'

const APP_URL_ALLOWLIST = new Set<string>(['https://github.com/FilippoTonci/sanctum'])
const STATUS_CHANNEL = 'sanctum:status-change'
const STATUS_GET_CHANNEL = 'sanctum:get-status'

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
