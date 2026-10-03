import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('app launches and renders the placeholder', async () => {
  // Own user-data dir per run: Electron ignores HOME for userData, so without
  // this concurrent runs share one settings.json.
  const home = mkdtempSync(join(tmpdir(), 'sanctum-e2e-'))
  const app = await electron.launch({
    args: [
      resolve(__dirname, '../../out/main/index.js'),
      `--user-data-dir=${join(home, 'userData')}`,
    ],
    env: {
      ...process.env,
      HOME: home,
      ELECTRON_DISABLE_SANDBOX_WARNING: '1',
      // CI runners don't have the Python backend installed. Skip the spawn;
      // status stays at `idle` and the splash renders the idle message.
      SANCTUM_SKIP_SIDECAR: '1',
    },
  })

  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  // Both strings are rendered by components/DropZone.tsx (studio home screen).
  // The heading names the accepted formats, which D4/D5 extend, hence the regex.
  await expect(win.getByRole('heading', { level: 1 })).toHaveText(/^Drop a .+ to review$/)
  await expect(win.getByText(/never leaves this computer/)).toBeVisible()

  await app.close()
})

test('native menu commands reach the renderer', async () => {
  const home = mkdtempSync(join(tmpdir(), 'sanctum-e2e-'))
  const app = await electron.launch({
    args: [
      resolve(__dirname, '../../out/main/index.js'),
      `--user-data-dir=${join(home, 'userData')}`,
    ],
    env: {
      ...process.env,
      HOME: home,
      ELECTRON_DISABLE_SANDBOX_WARNING: '1',
      SANCTUM_SKIP_SIDECAR: '1',
    },
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await expect(win.getByRole('heading', { level: 1 })).toBeVisible()

  // Menu accelerators cannot be driven from Playwright; run the item's click
  // handler in the main process, which is the IPC path the accelerator takes.
  const clickItem = (label: string): Promise<void> =>
    app.evaluate(({ Menu }, l) => {
      const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
        for (const i of items) {
          if (i.label === l) return i
          const hit = i.submenu ? find(i.submenu.items) : undefined
          if (hit) return hit
        }
        return undefined
      }
      const item = find(Menu.getApplicationMenu()?.items ?? [])
      if (!item) throw new Error(`no menu item ${l}`)
      ;(item.click as () => void)()
    }, label)

  await clickItem('Command Palette…')
  await expect(win.getByRole('dialog')).toBeVisible()
  await win.keyboard.press('Escape')
  await clickItem('Settings…')
  await expect(win.getByRole('heading', { name: /settings/i }).first()).toBeVisible()

  await app.close()
})
