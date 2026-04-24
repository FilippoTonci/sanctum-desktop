import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'

test('app launches and renders the placeholder', async () => {
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js')],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX_WARNING: '1' },
  })

  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  await expect(win.locator('h1')).toHaveText('Sanctum Desktop')
  await expect(win.locator('.tagline')).toContainText('Local-first')

  await app.close()
})
