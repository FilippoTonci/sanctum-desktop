import type { ReactElement } from 'react'

/**
 * Wordmark glyph: a filled square with one horizontal bar knocked out —
 * a redaction bar, the one thing this app makes. Decorative
 * (aria-hidden); the adjacent text carries the name.
 */
export function SanctumEmblem(): ReactElement {
  return (
    <svg className="sanctum-emblem" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1" y="1" width="18" height="18" rx="5" fill="currentColor" />
      <rect x="5" y="8.25" width="10" height="3.5" rx="1" fill="var(--emblem-bar)" />
    </svg>
  )
}
