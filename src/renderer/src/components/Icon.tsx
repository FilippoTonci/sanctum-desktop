import type { ReactElement } from 'react'

/**
 * Minimal inline icon set (1.5px strokes on a 16px grid). Inline SVG so
 * nothing is fetched at runtime and colour follows `currentColor`.
 */
const PATHS = {
  plus: 'M8 3.5v9M3.5 8h9',
  doc: 'M4.5 2.5h4.5l2.5 2.5v8.5h-7zM9 2.5V5h2.5',
  search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.3 10.3l3.2 3.2',
  settings:
    'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2',
  chevronRight: 'M6 4l4 4-4 4',
  chevronDown: 'M4 6l4 4 4-4',
  chevronUp: 'M4 10l4-4 4 4',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.5l3 3 6-7',
  undo: 'M5.5 4.5L2.5 7.5l3 3M2.5 7.5h7a3.5 3.5 0 0 1 0 7h-2',
  sidebar: 'M2.5 3h11v10h-11zM6 3v10',
  lock: 'M4.5 7h7v6h-7zM6 7V5a2 2 0 0 1 4 0v2',
  marker: 'M3 13h4M9.5 3.5l3 3L7 12H4v-3z',
  back: 'M10 4L6 8l4 4',
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 16,
  className,
}: {
  readonly name: IconName
  readonly size?: number
  readonly className?: string
}): ReactElement {
  return (
    <svg
      className={className === undefined ? 'icon' : `icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** Keyboard hint chip. `keys` is a list so combos render as separate caps. */
export function Kbd({ keys }: { readonly keys: readonly string[] }): ReactElement {
  return (
    <span className="kbd-group" aria-hidden="true">
      {keys.map((k) => (
        <kbd key={k} className="kbd">
          {k}
        </kbd>
      ))}
    </span>
  )
}
