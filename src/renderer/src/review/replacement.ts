/**
 * Replacement methods: how the Settings choice (`replacementStyle`) maps
 * onto the engine's operators when a review session is created.
 *
 *   label  → replace                 "<PERSON>"
 *   fixed  → replace + new_value     "[REDACTED]" (the user's marker)
 *   fake   → hips                    made-up data of the same kind
 *
 * The engine renders every preview and the saved copy from this one
 * choice; the renderer never computes a replacement itself.
 */

import type { CreateReviewSessionRequest } from '../api/types'
import type { AppSettings, ReplacementStyle } from '../sanctum'
import type { OperatorName } from './types'

export interface SessionOperator {
  readonly operator: OperatorName
  readonly params?: Readonly<Record<string, unknown>>
}

/** The marker used when the user leaves the fixed text blank. */
export const DEFAULT_MARKER = '[REDACTED]'

export function sessionOperatorFor(
  style: ReplacementStyle,
  fixedText: string = DEFAULT_MARKER,
): SessionOperator {
  switch (style) {
    case 'label':
      return { operator: 'replace' }
    case 'fixed':
      return {
        operator: 'replace',
        params: { new_value: fixedText.trim() === '' ? DEFAULT_MARKER : fixedText },
      }
    case 'fake':
      return { operator: 'hips' }
  }
}

/**
 * Build the create-session body from Settings: the operator for the
 * chosen replacement style, plus the entity filter. With no settings
 * (plain-browser preview) it falls back to entity-tag labels.
 */
export function sessionRequestFromSettings(
  path: string,
  settings: AppSettings | null | undefined,
): CreateReviewSessionRequest {
  const { operator, params } = sessionOperatorFor(
    settings?.replacementStyle ?? 'label',
    settings?.replacementText,
  )
  return {
    input_path: path,
    default_operator: operator,
    ...(params !== undefined ? { default_operator_params: { ...params } } : {}),
    ...(settings?.entityTypes !== null && settings?.entityTypes !== undefined
      ? { entities: settings.entityTypes }
      : {}),
  }
}

/** A session's method as the engine reports it. */
export interface SessionMethod {
  readonly operator: string
  readonly params: Readonly<Record<string, unknown>>
}

function sameParams(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => Object.is(a[k], b[k]))
}

/** Whether an open session already uses the method Settings would create it with. */
export function sessionMatchesSettings(
  session: SessionMethod,
  settings: Pick<AppSettings, 'replacementStyle' | 'replacementText'>,
): boolean {
  const want = sessionOperatorFor(settings.replacementStyle, settings.replacementText)
  return session.operator === want.operator && sameParams(session.params, want.params ?? {})
}

/** A session's method in words, for Settings, e.g. "realistic fake data". */
export function describeMethod(session: SessionMethod): string {
  if (session.operator === 'hips') return 'realistic fake data'
  if (session.operator === 'replace') {
    const marker = session.params.new_value
    return typeof marker === 'string' ? `the marker ${marker}` : 'entity tags such as <PERSON>'
  }
  return 'a method Settings does not offer'
}
