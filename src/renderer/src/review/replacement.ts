/**
 * Replacement methods: how the Settings choice (`replacementStyle`) maps
 * onto the engine's operators when a review session is created.
 *
 *   label  → replace                 "<PERSON>"
 *   fixed  → replace + new_value     "[REDACTED]" (the user's marker)
 *   fake   → hips                    made-up data of the same kind
 *   mask   → mask, every character   "**********"
 *   remove → redact                  ""
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

/**
 * Mask every character. Presidio's `mask` hides `min(len, chars_to_mask)`
 * characters, so a cap any finite length could exceed would leave the
 * tail of a long hand-marked span in clear text. JSON-safe and a Python int.
 */
export const MASK_ALL_PARAMS: Readonly<Record<string, unknown>> = {
  masking_char: '*',
  chars_to_mask: Number.MAX_SAFE_INTEGER,
  from_end: false,
}

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
    case 'mask':
      return { operator: 'mask', params: MASK_ALL_PARAMS }
    case 'remove':
      return { operator: 'redact' }
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
