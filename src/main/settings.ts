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
 *   scoreThreshold     → SANCTUM_ANALYZER__DEFAULT_SCORE_THRESHOLD, and below
 *                        Balanced also SANCTUM_NLP__NER_THRESHOLD (see below)
 *   defaultOperator    → SANCTUM_ANONYMIZER__DEFAULT_OPERATOR
 *
 * The remaining keys are renderer-side preferences. They never reach the
 * sidecar's environment (so changing them does not respawn it):
 *
 *   entityTypes        → `entities` on POST /review-sessions (null = all)
 *   replacementStyle   → `default_operator` + `default_operator_params` on
 *                        POST /review-sessions (the mapping lives in the
 *                        renderer's review/replacement.ts)
 *   replacementText    → the fixed text used when replacementStyle='fixed'
 *   outputSuffix       → appended to the source name in the save dialog
 *   saveNextToOriginal → seed the save dialog in the source file's folder
 *   theme              → renderer colour scheme (system / light / dark)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * How the review session replaces what it finds:
 *   label  → the entity tag, e.g. <PERSON>          (replace)
 *   fixed  → replacementText everywhere              (replace + new_value)
 *   fake   → realistic made-up data of the same kind (hips)
 */
export type ReplacementStyle = 'label' | 'fixed' | 'fake'

export const REPLACEMENT_STYLES: readonly ReplacementStyle[] = ['label', 'fixed', 'fake']
export type ThemePreference = 'system' | 'light' | 'dark'

export interface AppSettings {
  /** Inclusive lower bound on Presidio's confidence score. 0–1. */
  readonly scoreThreshold: number
  /** Session-default operator. Same set as the renderer's OperatorName. */
  readonly defaultOperator: string
  /** Entity types to detect; null means every type the engine supports. */
  readonly entityTypes: readonly string[] | null
  /** How findings are replaced; see ReplacementStyle. */
  readonly replacementStyle: ReplacementStyle
  readonly replacementText: string
  /** Suffix appended to the source file name, e.g. "_anonymized". */
  readonly outputSuffix: string
  /** Open the save dialog in the original document's folder. */
  readonly saveNextToOriginal: boolean
  readonly theme: ThemePreference
}

export const DEFAULT_SETTINGS: AppSettings = {
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
      const parsed = JSON.parse(raw) as Record<string, unknown>
      // Keep only keys this build knows: a retired one (e.g. nerBackend,
      // from before the single bundled model) must not be written back.
      const known = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => key in DEFAULT_SETTINGS),
      ) as Partial<AppSettings>
      this.cache = sanitize({ ...DEFAULT_SETTINGS, ...known })
    } catch {
      // Corrupt settings file: fall back to defaults rather than crashing
      // the app on boot. The user's next save will overwrite.
      this.cache = DEFAULT_SETTINGS
    }
    return this.cache
  }

  async update(next: Partial<AppSettings>): Promise<AppSettings> {
    const merged = sanitize({ ...this.read(), ...next })
    await mkdir(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(merged, null, 2), { mode: 0o600 })
    this.cache = merged
    return merged
  }
}

/**
 * Replace values this build does not understand with the default, so a
 * settings file written by a newer build (or edited by hand) can't feed
 * an unknown replacement style into session creation.
 */
function sanitize(settings: AppSettings): AppSettings {
  if (REPLACEMENT_STYLES.includes(settings.replacementStyle)) return settings
  return { ...settings, replacementStyle: DEFAULT_SETTINGS.replacementStyle }
}

/** The Balanced preset; below it the name model looks harder too. */
const BALANCED_THRESHOLD = 0.35
/**
 * The bundled name model only reports hits above its own threshold (0.2 in
 * the engine), and the engine lifts those onto >= 0.35, so lowering the
 * analyzer cut-off alone can't surface anything new from the model:
 * Thorough found exactly what Balanced did (#59). Below Balanced, lower
 * the model's threshold as well. On the sanctum-research hard corpus at
 * 0.25: model 0.2 misses 18 of 487 (78 false alarms), 0.15 misses 11
 * (122), 0.1 misses 3 (203). Thorough is opt-in and a leak costs more
 * than a false alarm, so it takes 0.1.
 */
const THOROUGH_NER_THRESHOLD = '0.1'

export function settingsToEnv(settings: AppSettings): Record<string, string> {
  return {
    SANCTUM_ANALYZER__DEFAULT_SCORE_THRESHOLD: settings.scoreThreshold.toString(),
    SANCTUM_ANONYMIZER__DEFAULT_OPERATOR: settings.defaultOperator,
    ...(settings.scoreThreshold < BALANCED_THRESHOLD
      ? { SANCTUM_NLP__NER_THRESHOLD: THOROUGH_NER_THRESHOLD }
      : {}),
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
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].some((k) => a[k] !== b[k])
}
