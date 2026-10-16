import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Smoke test for an *installed* build — the artifact a user actually runs,
 * not `out/main/index.js`. CI installs the installer first and points
 * SANCTUM_INSTALLED_APP at the app executable it put on disk.
 *
 * What it proves that the dev-build e2e cannot: the PyInstaller sidecar is
 * inside the installer, it starts on this OS, the bundled NER model loads
 * (PERSON comes only from the ONNX recognizer, not from a regex), and quitting
 * the app takes the sidecar down with it — Windows has no real SIGTERM, so
 * that path is the one most likely to leave an orphan.
 */
const executablePath = process.env.SANCTUM_INSTALLED_APP
const SIDECAR_IMAGE = 'sanctum-sidecar.exe'

interface Detection {
  readonly entity_type: string
  readonly text_span: string
}

test.skip(executablePath === undefined, 'set SANCTUM_INSTALLED_APP to an installed app executable')

test('installed app starts its bundled backend and detects a name', async () => {
  test.setTimeout(8 * 60_000)
  if (executablePath === undefined) return

  // Compare against what was running before launch, not zero: a developer
  // machine may have its own sidecar up.
  const baseline = sidecarProcessCount()
  const home = mkdtempSync(join(tmpdir(), 'sanctum-package-'))
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${join(home, 'userData')}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX_WARNING: '1' },
  })

  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')

    // A cold runner loads ~200 MB of model behind Defender's on-access scan;
    // the main process's own budget is 180 s for the handshake alone.
    const getStatus = (): ReturnType<typeof window.sanctum.getStatus> =>
      win.evaluate(() => window.sanctum.getStatus())
    await expect
      .poll(async () => (await getStatus()).state, { timeout: 6 * 60_000, intervals: [2_000] })
      .toMatch(/^(ready|error)$/)

    const status = await getStatus()
    if (status.state !== 'ready') {
      throw new Error(`backend failed to start: ${JSON.stringify(status)}`)
    }

    const response = await fetch(`${status.baseUrl}/analyze`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${status.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Please send the signed contract to Margaret Okafor at margaret.okafor@example.com.',
      }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { detections: Detection[] }
    console.log('detections:', JSON.stringify(body.detections))

    const types = body.detections.map((d) => d.entity_type)
    expect(types).toContain('PERSON')
    expect(types).toContain('EMAIL_ADDRESS')
  } finally {
    await app.close()
  }

  // `before-quit` kills the sidecar before the app exits; give the OS a
  // moment to reap it, then make sure nothing is left behind.
  await expect.poll(sidecarProcessCount, { timeout: 15_000 }).toBe(baseline)
})

function sidecarProcessCount(): number {
  if (process.platform === 'win32') {
    const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${SIDECAR_IMAGE}`, '/NH'], {
      encoding: 'utf8',
    })
    return out.split('\n').filter((line) => line.trim().startsWith(SIDECAR_IMAGE)).length
  }
  try {
    const out = execFileSync('pgrep', ['-f', 'sanctum-sidecar'], { encoding: 'utf8' })
    return out.split('\n').filter((line) => line.trim() !== '').length
  } catch {
    // pgrep exits 1 when nothing matches.
    return 0
  }
}
