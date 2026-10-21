import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSidecar, type SidecarHandle } from '../../src/main/sidecar'

/**
 * Live check of every replacement style against the real engine: create a
 * session with the operator the app sends for that style, redact every
 * finding, and save. The save runs the engine's leak check, so a style
 * whose output still contains an original fails here.
 *
 * The request bodies are spelled out on the wire: this lane is in the
 * Node tsconfig project and can't import the renderer. Each body is the
 * one `sessionRequestFromSettings` produces for the style (pinned by
 * tests/unit/renderer/replacement.test.ts).
 *
 * Needs the sibling `sanctum` checkout (for its NDA fixture and the
 * `sanctum` CLI on $PATH) and the NER model in ~/.cache/sanctum/models.
 * Point SANCTUM_DEV_REPO at the checkout when it isn't at ../sanctum.
 * The sidecar runs with HOME set to a temp dir so these sessions never
 * show up in the user's Recent Sessions.
 */
const repo = process.env.SANCTUM_DEV_REPO ?? resolve(process.cwd(), '../sanctum')
const fixture = join(repo, 'tests/fixtures/office/nda_contract.docx')
const modelDir = join(homedir(), '.cache/sanctum/models/gliner-pii-base-v1.0')
const skip =
  process.env.SANCTUM_SKIP_LIVE_TESTS === '1' || !existsSync(fixture) || !existsSync(modelDir)

/** What the app sends per style (review/replacement.ts). */
const OPERATOR_FOR = {
  label: { default_operator: 'replace' },
  fake: { default_operator: 'hips' },
  mask: {
    default_operator: 'mask',
    default_operator_params: {
      masking_char: '*',
      chars_to_mask: Number.MAX_SAFE_INTEGER,
      from_end: false,
    },
  },
  remove: { default_operator: 'redact' },
} as const

interface Proposal {
  readonly detection_id: string
  readonly entity_type: string
  readonly original: string
  readonly group_index?: number | null
  readonly group_original?: string | null
}

interface Session {
  readonly id: string
  readonly default_operator: string
  readonly proposals: readonly Proposal[]
  readonly previews: Record<string, string>
}

const isHead = (p: Proposal): boolean => (p.group_index ?? 0) === 0
const originalOf = (p: Proposal): string => p.group_original ?? p.original

describe.skipIf(skip)('replacement methods live', () => {
  let home: string
  let handle: SidecarHandle

  beforeAll(async () => {
    // realpath: the engine refuses symlinked paths, and macOS's tmpdir()
    // sits under /var -> /private/var.
    home = await realpath(await mkdtemp(join(tmpdir(), 'sanctum-replacement-')))
    handle = await spawnSidecar({
      readyTimeoutMs: 90_000,
      commandResolver: () => ({
        command: 'sanctum',
        args: ['serve', '--port', '0', '--token-stdin'],
        env: {
          PYTHONUNBUFFERED: '1',
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
          HOME: home,
          SANCTUM_NLP__NER_MODEL_DIR: modelDir,
        },
      }),
    })
  }, 120_000)

  afterAll(async () => {
    await handle.kill()
    await rm(home, { recursive: true, force: true })
  })

  async function call<T>(method: string, path: string, body: unknown): Promise<T> {
    const res = await fetch(`${handle.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${handle.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${path} → ${String(res.status)}: ${text}`)
    return JSON.parse(text) as T
  }

  /** Create a session for `style` on a fresh copy of the fixture. */
  async function open(style: keyof typeof OPERATOR_FOR): Promise<Session> {
    const input = join(home, `${style}-${String(Date.now())}.docx`)
    await copyFile(fixture, input)
    return call<Session>('POST', '/review-sessions', {
      input_path: input,
      ...OPERATOR_FOR[style],
    })
  }

  /** Redact every finding (one request per finding, by its head), then save. */
  async function redactAllAndSave(session: Session): Promise<string> {
    for (const p of session.proposals.filter(isHead)) {
      await call('PATCH', `/review-sessions/${session.id}/decisions/${p.detection_id}`, {
        status: 'accept',
      })
    }
    const output = join(home, `${session.id}-out.docx`)
    const res = await call<{ output_path: string }>(
      'POST',
      `/review-sessions/${session.id}/commit`,
      { output_path: output, attested: true },
    )
    return res.output_path
  }

  it('label: entity tags', async () => {
    const s = await open('label')
    expect(s.default_operator).toBe('replace')
    const heads = s.proposals.filter(isHead)
    expect(heads.length).toBeGreaterThan(0)
    for (const p of heads) expect(s.previews[p.detection_id]).toBe(`<${p.entity_type}>`)
    expect(existsSync(await redactAllAndSave(s))).toBe(true)
  }, 120_000)

  it('fake: made-up values that differ from the originals, and the save check passes', async () => {
    const s = await open('fake')
    expect(s.default_operator).toBe('hips')
    for (const p of s.proposals.filter(isHead)) {
      const preview = s.previews[p.detection_id]
      expect(preview).toBeTruthy()
      expect(preview).not.toBe(originalOf(p))
    }
    expect(existsSync(await redactAllAndSave(s))).toBe(true)
  }, 120_000)

  // Known engine defect (sanctum anonymizer/operators/hips.py): Presidio
  // builds a fresh HipsOperator per finding and its __init__ reseeds Faker
  // with 42, so every PERSON becomes the same name. When the engine fixes
  // this, `it.fails` turns red: switch it to `it`.
  it.fails(
    'fake: distinct people get distinct fake names',
    async () => {
      const s = await open('fake')
      const people = new Map<string, string>()
      for (const p of s.proposals.filter(isHead)) {
        if (p.entity_type !== 'PERSON') continue
        people.set(originalOf(p), s.previews[p.detection_id] ?? '')
      }
      expect(people.size).toBeGreaterThan(1)
      expect(new Set(people.values()).size).toBe(people.size)
    },
    120_000,
  )

  it('mask: one * per character of the whole finding', async () => {
    const s = await open('mask')
    expect(s.default_operator).toBe('mask')
    for (const p of s.proposals.filter(isHead)) {
      expect(s.previews[p.detection_id]).toBe('*'.repeat(originalOf(p).length))
    }
    expect(existsSync(await redactAllAndSave(s))).toBe(true)
  }, 120_000)

  it('remove: empty replacements, and the save check passes', async () => {
    const s = await open('remove')
    expect(s.default_operator).toBe('redact')
    for (const p of s.proposals) expect(s.previews[p.detection_id]).toBe('')
    expect(existsSync(await redactAllAndSave(s))).toBe(true)
  }, 120_000)
})
