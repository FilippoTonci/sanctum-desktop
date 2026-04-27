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
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export type NerBackend = 'spacy' | 'gliner'

export interface AppSettings {
  /** spacy = Standard tier (~15 MB); gliner = Professional tier (~1.4 GB). */
  readonly nerBackend: NerBackend
  /** Inclusive lower bound on Presidio's confidence score. 0–1. */
  readonly scoreThreshold: number
  /** Session-default operator. Same set as the renderer's OperatorName. */
  readonly defaultOperator: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  nerBackend: 'spacy',
  scoreThreshold: 0.35,
  defaultOperator: 'hips',
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
