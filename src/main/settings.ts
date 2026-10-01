/**
 * Persistent app settings, surfaced to the renderer via IPC and applied
 * to the sidecar as environment variables on respawn.
 *
 * Storage is a JSON file under Electron's `app.getPath('userData')` —
 * cross-platform per-user state, no extra dependency. Reads are
 * synchronous on demand (the file is small, the path is cheap to stat);
 * writes happen on every `update()` so a crash never loses a user's
 * choice.
 *
 * Settings map onto Sanctum's pydantic-settings env-var convention:
 *
 *   nerBackend         → SANCTUM_NLP__NER_BACKEND
 *   scoreThreshold     → SANCTUM_ANALYZER__DEFAULT_SCORE_THRESHOLD
 *   defaultOperator    → SANCTUM_ANONYMIZER__DEFAULT_OPERATOR
 *
 * The remaining keys are renderer-side preferences. They never reach the
 * sidecar's environment (so changing them does not respawn it):
 *
 *   entityTypes        → `entities` on POST /review-sessions (null = all)
 *   replacementStyle   → `default_operator_params` for the replace operator
 *   replacementText    → the fixed text used when replacementStyle='fixed'
 *   outputSuffix       → appended to the source name in the save dialog
 *   saveNextToOriginal → seed the save dialog in the source file's folder
 *   theme              → renderer colour scheme (system / light / dark)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export type NerBackend = 'spacy' | 'gliner'
export type ReplacementStyle = 'label' | 'fixed'
export type ThemePreference = 'system' | 'light' | 'dark'

export interface AppSettings {
  /** spacy = Standard tier (~15 MB); gliner = Professional tier (~1.4 GB). */
  readonly nerBackend: NerBackend
  /** Inclusive lower bound on Presidio's confidence score. 0–1. */
  readonly scoreThreshold: number
  /** Session-default operator. Same set as the renderer's OperatorName. */
  readonly defaultOperator: string
  /** Entity types to detect; null means every type the engine supports. */
  readonly entityTypes: readonly string[] | null
  /** 'label' writes the entity tag (<PERSON>); 'fixed' writes replacementText. */
  readonly replacementStyle: ReplacementStyle
  readonly replacementText: string
  /** Suffix appended to the source file name, e.g. "_anonymized". */
  readonly outputSuffix: string
  /** Open the save dialog in the original document's folder. */
  readonly saveNextToOriginal: boolean
  readonly theme: ThemePreference
}

export const DEFAULT_SETTINGS: AppSettings = {
  nerBackend: 'spacy',
  scoreThreshold: 0.35,
  defaultOperator: 'replace',
  entityTypes: null,
  replacementStyle: 'label',
  replacementText: '[REDACTED]',
  outputSuffix: '_anonymized',
  saveNextToOriginal: true,
  theme: 'system',
}

export class SettingsStore {
  private cache: AppSettings | null = null

  constructor(private readonly path: string) {}

  read(): AppSettings {
    if (this.cache !== null) return this.cache
    if (!existsSync(this.path)) {
      this.cache = DEFAULT_SETTINGS
      return this.cache
    }
    try {
      const raw = readFileSync(this.path, 'utf8')
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      this.cache = { ...DEFAULT_SETTINGS, ...parsed }
    } catch {
      // Corrupt settings file: fall back to defaults rather than crashing
      // the app on boot. The user's next save will overwrite.
      this.cache = DEFAULT_SETTINGS
    }
    return this.cache
  }

  async update(next: Partial<AppSettings>): Promise<AppSettings> {
    const merged = { ...this.read(), ...next }
    await mkdir(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(merged, null, 2), { mode: 0o600 })
    this.cache = merged
    return merged
  }
}

export function settingsToEnv(settings: AppSettings): Record<string, string> {
  return {
    SANCTUM_NLP__NER_BACKEND: settings.nerBackend,
    SANCTUM_ANALYZER__DEFAULT_SCORE_THRESHOLD: settings.scoreThreshold.toString(),
    SANCTUM_ANONYMIZER__DEFAULT_OPERATOR: settings.defaultOperator,
  }
}

/**
 * True when moving from `prev` to `next` changes the sidecar's
 * environment. Renderer-only preferences (theme, output naming, …) are
 * applied without tearing the sidecar down.
 */
export function needsRespawn(prev: AppSettings, next: AppSettings): boolean {
  const a = settingsToEnv(prev)
  const b = settingsToEnv(next)
  return Object.keys(b).some((k) => a[k] !== b[k])
}
