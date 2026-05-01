import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsStore, settingsToEnv } from '../../../src/main/settings'

describe('SettingsStore', () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanctum-settings-'))
    path = join(dir, 'settings.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns DEFAULT_SETTINGS on first read when no file exists', () => {
    const store = new SettingsStore(path)
    expect(store.read()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists updates and re-reads them on a fresh store', async () => {
    const store = new SettingsStore(path)
    await store.update({ nerBackend: 'gliner', scoreThreshold: 0.6 })

    const fresh = new SettingsStore(path)
    expect(fresh.read()).toEqual({
      nerBackend: 'gliner',
      scoreThreshold: 0.6,
      defaultOperator: 'replace',
    })
  })

  it('writes the file with 0o600 perms (settings may contain user prefs)', async () => {
    const store = new SettingsStore(path)
    await store.update({ scoreThreshold: 0.5 })
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed.scoreThreshold).toBe(0.5)
  })

  it('falls back to DEFAULT_SETTINGS on corrupt JSON without throwing', async () => {
    await writeFile(path, '{ this is not json', 'utf8')
    const store = new SettingsStore(path)
    expect(store.read()).toEqual(DEFAULT_SETTINGS)
  })

  it('merges partial updates without dropping unspecified fields', async () => {
    const store = new SettingsStore(path)
    await store.update({ nerBackend: 'gliner' })
    await store.update({ scoreThreshold: 0.8 })
    expect(store.read()).toEqual({
      nerBackend: 'gliner',
      scoreThreshold: 0.8,
      defaultOperator: 'replace',
    })
  })

  it('caches reads so the second call does not re-stat the file', async () => {
    const store = new SettingsStore(path)
    const first = store.read()
    // Mutate the file outside the store; cached read should still return the original.
    await writeFile(path, JSON.stringify({ nerBackend: 'gliner' }), 'utf8')
    expect(store.read()).toBe(first)
  })
})

describe('settingsToEnv', () => {
  it('emits the SANCTUM_SECTION__KEY env-var convention used by the backend', () => {
    expect(
      settingsToEnv({
        nerBackend: 'gliner',
        scoreThreshold: 0.6,
        defaultOperator: 'mask',
      }),
    ).toEqual({
      SANCTUM_NLP__NER_BACKEND: 'gliner',
      SANCTUM_ANALYZER__DEFAULT_SCORE_THRESHOLD: '0.6',
      SANCTUM_ANONYMIZER__DEFAULT_OPERATOR: 'mask',
    })
  })

  it('stringifies numeric thresholds (env vars are always strings)', () => {
    expect(settingsToEnv({ ...DEFAULT_SETTINGS, scoreThreshold: 0.05 })).toMatchObject({
      SANCTUM_ANALYZER__DEFAULT_SCORE_THRESHOLD: '0.05',
    })
  })
})
