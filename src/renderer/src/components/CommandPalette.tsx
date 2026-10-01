import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Icon, Kbd } from './Icon'

export interface Command {
  readonly id: string
  readonly title: string
  readonly group: string
  readonly keys?: readonly string[]
  /** Extra words that should match the query but aren't shown. */
  readonly keywords?: string
  readonly disabled?: boolean
  readonly run: () => void
}

interface CommandPaletteProps {
  readonly open: boolean
  readonly commands: readonly Command[]
  readonly onClose: () => void
}

/**
 * Score a command against the query: every query word must appear as a
 * prefix of some word in the title/keywords (in any order). Earlier hits
 * rank higher. Returns -1 for no match. Exported for tests.
 */
export function scoreCommand(command: Pick<Command, 'title' | 'keywords'>, query: string): number {
  const q = query.trim().toLowerCase()
  if (q === '') return 0
  const haystack = `${command.title} ${command.keywords ?? ''}`.toLowerCase()
  const words = haystack.split(/[^a-z0-9]+/).filter((w) => w !== '')
  let score = 0
  for (const part of q.split(/\s+/)) {
    const idx = words.findIndex((w) => w.startsWith(part))
    if (idx === -1) {
      if (!haystack.includes(part)) return -1
      score += 20
    } else {
      score += idx
    }
  }
  return score
}

/**
 * Cmd+K command palette: every action in the app, searchable, with its
 * shortcut shown so the palette also teaches the keyboard map.
 */
export function CommandPalette({
  open,
  commands,
  onClose,
}: CommandPaletteProps): ReactElement | null {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    inputRef.current?.focus()
  }, [open])

  const results = useMemo(() => {
    const scored = commands
      .filter((c) => c.disabled !== true)
      .map((c, i) => ({ c, i, s: scoreCommand(c, query) }))
      .filter((x) => x.s >= 0)
    if (query.trim() !== '') scored.sort((a, b) => a.s - b.s || a.i - b.i)
    return scored.map((x) => x.c)
  }, [commands, query])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${String(active)}"]`)
    if (el !== null && el !== undefined && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [active])

  if (!open) return null

  const run = (command: Command | undefined): void => {
    if (command === undefined) return
    onClose()
    // Let the palette unmount (and focus return) before the command runs,
    // so commands that move focus or open other overlays are not undone.
    window.setTimeout(command.run, 0)
  }

  let lastGroup = ''

  return (
    <div
      className="overlay overlay-top"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-search">
          <Icon name="search" />
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
            placeholder="Type a command or search…"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => Math.min(results.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(results[active])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
          />
          <Kbd keys={['esc']} />
        </div>
        <ul className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {results.length === 0 ? (
            <li className="palette-empty">No matching commands.</li>
          ) : (
            results.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null
              lastGroup = c.group
              return (
                <li key={c.id} role="presentation">
                  {header !== null ? <div className="palette-group">{header}</div> : null}
                  <div
                    id={`cmd-${c.id}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === active}
                    data-index={i}
                    className={`palette-item${i === active ? ' is-active' : ''}`}
                    onMouseMove={() => {
                      if (i !== active) setActive(i)
                    }}
                    onClick={() => {
                      run(c)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') run(c)
                    }}
                  >
                    <span className="palette-item-title">{c.title}</span>
                    {c.keys !== undefined ? <Kbd keys={c.keys} /> : null}
                  </div>
                </li>
              )
            })
          )}
        </ul>
      </div>
    </div>
  )
}
