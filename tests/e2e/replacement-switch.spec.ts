import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Settings → Replacement text → "Apply to open document", end to end: the
 * built app, the real engine from the sibling `sanctum` checkout, and the
 * engine's NDA fixture.
 *
 * Needs `../sanctum` (or SANCTUM_DEV_REPO) with its venv, and the NER model
 * in ~/.cache/sanctum/models. Skips itself otherwise, so CI (which has no
 * engine) is unaffected. Run `npm run build` first.
 */
const repo = process.env.SANCTUM_DEV_REPO ?? resolve(__dirname, '../../../sanctum')
const venvBin = join(repo, '.venv/bin')
const fixture = join(repo, 'tests/fixtures/office/nda_contract.docx')
const modelDir = join(homedir(), '.cache/sanctum/models/gliner-pii-base-v1.0')
const live =
  process.env.SANCTUM_SKIP_LIVE_TESTS !== '1' &&
  existsSync(join(venvBin, 'sanctum')) &&
  existsSync(fixture) &&
  existsSync(modelDir)

test.skip(!live, 'needs the sibling sanctum checkout, its venv and the cached NER model')
test.describe.configure({ mode: 'serial', timeout: 240_000 })

interface Launched {
  readonly app: ElectronApplication
  readonly win: Page
  readonly home: string
}

/**
 * The test's environment minus ELECTRON_RUN_AS_NODE: editors built on
 * Electron (VS Code) set it for their terminals, and it makes the app
 * start as plain Node.
 */
function launchEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
  }
  return env
}

async function launch(): Promise<Launched> {
  // realpath: the engine refuses symlinked paths (macOS tmpdir is /var -> /private/var).
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'sanctum-e2e-switch-')))
  const app = await electron.launch({
    args: [
      resolve(__dirname, '../../out/main/index.js'),
      `--user-data-dir=${join(home, 'userData')}`,
    ],
    env: {
      ...launchEnv(),
      HOME: home,
      ELECTRON_DEV: '1',
      SANCTUM_DEV_REPO: repo,
      PATH: `${venvBin}:${process.env.PATH ?? ''}`,
      SANCTUM_NLP__NER_MODEL_DIR: modelDir,
      HF_HUB_OFFLINE: '1',
      ELECTRON_DISABLE_SANDBOX_WARNING: '1',
    },
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await expect(win.getByRole('heading', { level: 1 })).toHaveText(/^Drop a .+ to review$/)
  return { app, win, home }
}

/** Run a native menu item's click handler (accelerators can't be driven). */
async function clickMenu(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate(({ Menu }, l) => {
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
}

async function openFixture(win: Page, home: string): Promise<void> {
  const input = join(home, 'nda.docx')
  copyFileSync(fixture, input)
  await win.getByTestId('drop-zone-input').setInputFiles(input)
  await expect(win.getByTestId('docx-body')).toBeVisible({ timeout: 120_000 })
  // Analysis done: the canvas carries replacement chips for the findings.
  await expect(win.locator('.sanctum-edit').first()).toBeVisible({ timeout: 120_000 })
}

async function openReplacementSettings(app: ElectronApplication, win: Page): Promise<void> {
  await clickMenu(app, 'Settings…')
  await expect(win.getByTestId('settings-view')).toBeVisible()
  await win.getByRole('button', { name: 'Replacement text' }).click()
}

async function backToDocument(win: Page): Promise<void> {
  await win.getByRole('button', { name: /Back/ }).click()
  await expect(win.getByTestId('settings-view')).toHaveCount(0)
}

/** Replacement text currently drawn in the canvas, in document order. */
async function canvasReplacements(win: Page): Promise<string[]> {
  return win.locator('.sanctum-edit-replacement').allTextContents()
}

/** The Settings method bar and its Apply button. */
const methodBar = (win: Page) => win.getByTestId('open-document-method')
const applyButton = (win: Page) => win.getByRole('button', { name: 'Apply to open document' })

/** Accept every finding: Enter accepts the focused one and moves to the next. */
async function acceptAll(win: Page): Promise<void> {
  const progress = win.getByRole('progressbar', { name: 'Review progress' })
  for (let i = 0; i < 200; i++) {
    const done = await progress.getAttribute('aria-valuenow')
    if (done !== null && done === (await progress.getAttribute('aria-valuemax'))) return
    await win.keyboard.press('Enter')
  }
  throw new Error('findings still to review after 200 accepts')
}

function docxText(path: string): string {
  return execFileSync(
    join(venvBin, 'python'),
    [
      '-I',
      '-c',
      'import sys, docx; print("\\n".join(p.text for p in docx.Document(sys.argv[1]).paragraphs))',
      path,
    ],
    { encoding: 'utf8' },
  )
}

test('no document open: Settings offers nothing to apply', async () => {
  const { app, win } = await launch()
  try {
    await openReplacementSettings(app, win)
    await win.getByRole('radio', { name: /Realistic fake data/ }).click()
    await expect(win.getByRole('radio', { name: /Realistic fake data/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(methodBar(win)).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('switching the open document between methods keeps decisions and saves the chosen one', async () => {
  const { app, win, home } = await launch()
  try {
    await openFixture(win, home)

    // Give one finding a typed replacement, then accept everything: the
    // canvas draws replacements for accepted findings only, and every
    // switch below must keep the decisions and the typed text.
    await win.locator('.sanctum-edit').first().click()
    await win.keyboard.press('Enter')
    await win.keyboard.press('e')
    await win.keyboard.press('ControlOrMeta+a')
    await win.keyboard.type('[CLIENT]')
    await win.keyboard.press('Enter')
    await win.keyboard.press('Enter')
    await expect(win.locator('.sanctum-edit-replacement', { hasText: '[CLIENT]' })).toHaveCount(1)
    await acceptAll(win)
    const decided = '.sanctum-edit[data-status="accepted"]'
    const decidedBefore = await win.locator(decided).count()
    expect(decidedBefore).toBeGreaterThan(10)

    const asTags = await canvasReplacements(win)
    expect(asTags.length).toBeGreaterThan(3)
    expect(asTags.some((t) => /^<[A-Z_]+>$/.test(t))).toBe(true)

    // 1. Choose fake data: the open document is flagged, nothing changes yet.
    await openReplacementSettings(app, win)
    await win.getByRole('radio', { name: /Realistic fake data/ }).click()
    await expect(methodBar(win)).toContainText(
      'The open document, nda.docx, still uses entity tags',
    )
    await expect(applyButton(win)).toBeVisible()
    await win.screenshot({ path: test.info().outputPath('1-settings-offers-apply.png') })
    await win.emulateMedia({ colorScheme: 'dark' })
    await win.screenshot({ path: test.info().outputPath('1-settings-offers-apply-dark.png') })
    await win.emulateMedia({ colorScheme: 'light' })
    await backToDocument(win)
    expect(await canvasReplacements(win)).toEqual(asTags)

    // 2. Apply it.
    await openReplacementSettings(app, win)
    await applyButton(win).click()
    await expect(methodBar(win)).toContainText(
      'The open document, nda.docx, uses realistic fake data.',
    )
    await expect(applyButton(win)).toHaveCount(0)
    await win.screenshot({ path: test.info().outputPath('2-settings-applied.png') })
    await backToDocument(win)
    const asFakes = await canvasReplacements(win)
    expect(asFakes.length).toBe(asTags.length)
    expect(asFakes.some((t) => /^<[A-Z_]+>$/.test(t))).toBe(false)
    expect(asFakes).not.toEqual(asTags)
    expect(asFakes.filter((t) => t === '[CLIENT]')).toHaveLength(1)
    expect(await win.locator(decided).count()).toBe(decidedBefore)
    await win.screenshot({ path: test.info().outputPath('3-document-with-fakes.png') })

    // 3. A fixed marker, then back to fake data: the same fakes return.
    await openReplacementSettings(app, win)
    await win.getByRole('radio', { name: /Same text everywhere/ }).click()
    await expect(methodBar(win)).toContainText('still uses realistic fake data')
    await applyButton(win).click()
    await expect(methodBar(win)).toContainText('uses the marker [REDACTED]')
    await backToDocument(win)
    const asMarker = await canvasReplacements(win)
    expect(
      asMarker.filter((t) => t !== '' && t !== '[CLIENT]').every((t) => t === '[REDACTED]'),
    ).toBe(true)
    expect(asMarker.filter((t) => t === '[CLIENT]')).toHaveLength(1)

    await openReplacementSettings(app, win)
    await win.getByRole('radio', { name: /Realistic fake data/ }).click()
    await applyButton(win).click()
    await expect(methodBar(win)).toContainText('uses realistic fake data')
    await backToDocument(win)
    expect(await canvasReplacements(win)).toEqual(asFakes)

    // 4. Save: the copy carries the fakes, not tags, and passes the leak check.
    const out = join(home, 'nda_anonymized.docx')
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: p })
    }, out)
    await clickMenu(app, 'Save Redacted Copy…')
    const panel = win.getByTestId('commit-panel')
    await panel.getByRole('checkbox').check()
    await panel.getByRole('button', { name: /Save redacted copy/ }).click()
    await expect(panel.getByText(out)).toBeVisible({ timeout: 60_000 })
    const saved = docxText(out)
    expect(saved).not.toMatch(/<[A-Z_]+>/)
    expect(saved).not.toContain('Rachel Moore')
    expect(saved).toContain('[CLIENT]')
    const fakePerson = asFakes.find((t) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(t))
    expect(fakePerson).toBeDefined()
    expect(saved).toContain(fakePerson)

    // 5. A saved document can't change method: Settings no longer offers it.
    await panel.getByRole('button', { name: 'Done' }).click()
    await openReplacementSettings(app, win)
    await win.getByRole('radio', { name: /Say what was removed/ }).click()
    await expect(methodBar(win)).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('a resumed document keeps the method it was switched to', async () => {
  const { app, win, home } = await launch()
  try {
    await openFixture(win, home)
    await openReplacementSettings(app, win)
    await win.getByRole('radio', { name: /Realistic fake data/ }).click()
    await applyButton(win).click()
    await expect(methodBar(win)).toContainText('uses realistic fake data')
    await backToDocument(win)
    const asFakes = await canvasReplacements(win)

    // Close without saving would discard the session; reload the window
    // instead, which drops renderer state and resumes from Recent Sessions.
    await win.reload()
    await expect(win.getByRole('heading', { level: 1 })).toHaveText(/^Drop a .+ to review$/)
    await win
      .getByRole('button', { name: /nda\.docx/ })
      .first()
      .click()
    await expect(win.locator('.sanctum-edit').first()).toBeVisible({ timeout: 120_000 })
    expect(await canvasReplacements(win)).toEqual(asFakes)

    await openReplacementSettings(app, win)
    await win.getByRole('radio', { name: /Realistic fake data/ }).click()
    await expect(methodBar(win)).toContainText('uses realistic fake data')
  } finally {
    await app.close()
  }
})
