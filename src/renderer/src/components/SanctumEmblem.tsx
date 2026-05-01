import type { ReactElement } from 'react'

/**
 * Wordmark emblem — italic Fraunces "S" inside a circular hairline,
 * orbited by a dotted halo. Lives in the page header next to the
 * title; purely decorative (aria-hidden) so screen readers skip it.
 */
export function SanctumEmblem(): ReactElement {
  return (
    <span className="sanctum-emblem" aria-hidden="true">
      <span className="sanctum-emblem-mark">S</span>
    </span>
  )
}
