import type { ReactElement, ReactNode } from 'react'
import type { SanctumStatus } from '../sanctum'
import { Icon, Kbd } from './Icon'
import { SanctumEmblem } from './SanctumEmblem'
import { engineLabel } from './Splash'

interface SidebarProps {
  readonly collapsed: boolean
  readonly status: SanctumStatus
  readonly settingsActive: boolean
  readonly onOpen: () => void
  readonly onPalette: () => void
  readonly onSettings: () => void
  readonly onToggle: () => void
  /** Recent documents list, then (in review) the detection list. */
  readonly children: ReactNode
}

/**
 * Persistent left sidebar. Collapses to an icon rail (⌘\\) — automatically
 * on narrow windows — and always ends with the quiet trust line.
 */
export function Sidebar({
  collapsed,
  status,
  settingsActive,
  onOpen,
  onPalette,
  onSettings,
  onToggle,
  children,
}: SidebarProps): ReactElement {
  return (
    <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label="Sidebar">
      <div className="sidebar-head">
        <span className="brand">
          <SanctumEmblem />
          <span className="brand-name">Sanctum</span>
        </span>
        <button
          type="button"
          className="btn btn-icon btn-ghost sidebar-toggle"
          onClick={onToggle}
          aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          title={`${collapsed ? 'Show' : 'Hide'} sidebar (⌘\\)`}
        >
          <Icon name="sidebar" />
        </button>
      </div>

      <div className="sidebar-actions">
        <button
          type="button"
          className="sidebar-action"
          onClick={onOpen}
          title="Open document (⌘O)"
        >
          <Icon name="plus" />
          <span className="sidebar-label">Open document</span>
          <Kbd keys={['⌘', 'O']} />
        </button>
        <button
          type="button"
          className="sidebar-action"
          onClick={onPalette}
          title="Command palette (⌘K)"
        >
          <Icon name="search" />
          <span className="sidebar-label">Commands</span>
          <Kbd keys={['⌘', 'K']} />
        </button>
      </div>

      <div className="sidebar-scroll">{collapsed ? null : children}</div>

      <footer className="sidebar-foot">
        <button
          type="button"
          className={`sidebar-action${settingsActive ? ' is-active' : ''}`}
          onClick={onSettings}
          title="Settings (⌘,)"
        >
          <Icon name="settings" />
          <span className="sidebar-label">Settings</span>
          <Kbd keys={['⌘', ',']} />
        </button>
        <p className="trust" title="Documents are processed by a local engine. No network access.">
          <span className={`trust-dot trust-dot-${status.state}`} aria-hidden="true" />
          <span className="sidebar-label">{engineLabel(status)}</span>
        </p>
      </footer>
    </aside>
  )
}
