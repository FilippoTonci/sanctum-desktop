import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'

test('app launches and renders the placeholder', async () => {
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js')],
    env: {
      ...process.env,
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
