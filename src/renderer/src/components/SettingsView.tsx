import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ALL_ENTITY_TYPES, ENTITY_GROUPS, entityLabel } from '../review/entities'
import type { AppSettings, SanctumStatus, ThemePreference } from '../sanctum'
import { suggestedOutputName } from './CommitPanel'
import { Icon, Kbd } from './Icon'
import { REVIEW_SHORTCUTS } from './Inspector'
import { engineLabel } from './Splash'

export type SettingsSection =
  | 'detection'
  | 'entities'
  | 'replacement'
  | 'saving'
  | 'appearance'
  | 'keyboard'
  | 'privacy'

export const SETTINGS_SECTIONS: readonly {
  readonly id: SettingsSection
  readonly label: string
}[] = [
  { id: 'detection', label: 'Detection' },
  { id: 'entities', label: 'What to find' },
  { id: 'replacement', label: 'Replacement text' },
  { id: 'saving', label: 'Saving' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'privacy', label: 'Privacy' },
]

/** Sensitivity presets over the engine's confidence threshold. */
export const SENSITIVITY_PRESETS: readonly {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly threshold: number
}[] = [
  {
    id: 'thorough',
    label: 'Thorough',
    hint: 'Flags more. Expect some false alarms to dismiss.',
    threshold: 0.25,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    hint: 'Recommended for most contracts and memos.',
    threshold: 0.35,
  },
  {
    id: 'strict',
    label: 'Precise',
    hint: 'Flags only confident matches. Check for misses.',
    threshold: 0.5,
  },
]

interface SettingsViewProps {
  readonly settings: AppSettings | null
  readonly status: SanctumStatus
  readonly section: SettingsSection
  readonly onSectionChange: (section: SettingsSection) => void
  /** Persist a patch. Resolves with the merged settings or rejects. */
  readonly onChange: (patch: Partial<AppSettings>) => Promise<void>
  readonly onClose: () => void
}

/**
 * Full-window Settings. Preferences apply as soon as they change; the two
 * engine settings (model and sensitivity) are staged and applied together
 * because they restart the local detection engine.
 */
export function SettingsView({
  settings,
  status,
  section,
  onSectionChange,
  onChange,
  onClose,
}: SettingsViewProps): ReactElement {
  const contentRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [section])

  return (
    <div className="settings" data-testid="settings-view">
      <nav className="settings-nav" aria-label="Settings sections">
        <button type="button" className="settings-back" onClick={onClose}>
          <Icon name="back" size={14} />
          Back
          <Kbd keys={['esc']} />
        </button>
        <h1 className="settings-title">Settings</h1>
        <ul>
          {SETTINGS_SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`settings-nav-item${s.id === section ? ' is-active' : ''}`}
                aria-current={s.id === section ? 'page' : undefined}
                onClick={() => {
                  onSectionChange(s.id)
                }}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="settings-content" ref={contentRef}>
        {settings === null ? (
          <p className="panel-empty">Loading settings…</p>
        ) : (
          <SectionBody section={section} settings={settings} status={status} onChange={onChange} />
        )}
      </div>
    </div>
  )
}

interface SectionBodyProps {
  readonly section: SettingsSection
  readonly settings: AppSettings
  readonly status: SanctumStatus
  readonly onChange: (patch: Partial<AppSettings>) => Promise<void>
}

function SectionBody({ section, settings, status, onChange }: SectionBodyProps): ReactElement {
  switch (section) {
    case 'detection':
      return <DetectionSection settings={settings} status={status} onChange={onChange} />
    case 'entities':
      return <EntitiesSection settings={settings} onChange={onChange} />
    case 'replacement':
      return <ReplacementSection settings={settings} onChange={onChange} />
    case 'saving':
      return <SavingSection settings={settings} onChange={onChange} />
    case 'appearance':
      return <AppearanceSection settings={settings} onChange={onChange} />
    case 'keyboard':
      return <KeyboardSection />
    case 'privacy':
      return <PrivacySection status={status} />
  }
}

function SectionHeader({
  title,
  lede,
}: {
  readonly title: string
  readonly lede: string
}): ReactElement {
  return (
    <header className="section-header">
      <h2 className="section-title">{title}</h2>
      <p className="section-lede">{lede}</p>
    </header>
  )
}

function Row({
  label,
  hint,
  children,
  htmlFor,
}: {
  readonly label: string
  readonly hint?: ReactNode
  readonly children: ReactNode
  readonly htmlFor?: string
}): ReactElement {
  return (
    <div className="setting-row">
      <div className="setting-row-text">
        {htmlFor !== undefined ? (
          <label className="setting-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="setting-label">{label}</span>
        )}
        {hint !== undefined ? <p className="setting-hint">{hint}</p> : null}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  )
}

/* ---------------------------------------------------------------- Detection */

function DetectionSection({
  settings,
  status,
  onChange,
}: {
  readonly settings: AppSettings
  readonly status: SanctumStatus
  readonly onChange: (patch: Partial<AppSettings>) => Promise<void>
}): ReactElement {
  const [threshold, setThreshold] = useState<number>(settings.scoreThreshold)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setThreshold(settings.scoreThreshold)
  }, [settings.scoreThreshold])

  const dirty = threshold !== settings.scoreThreshold
  const preset = SENSITIVITY_PRESETS.find((p) => Math.abs(p.threshold - threshold) < 1e-9)
  const restarting = status.state !== 'ready' && status.state !== 'error'

  const apply = (): void => {
    setSaving(true)
    setError(null)
    onChange({ scoreThreshold: threshold })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        setSaving(false)
      })
  }

  return (
    <section>
      <SectionHeader
        title="Detection"
        lede="How hard Sanctum looks for personal data. These apply to documents you open after the change."
      />

      <div className="setting-group">
        <Row
          label="Sensitivity"
          hint={
            preset?.hint ??
            `Custom: flags matches the engine is at least ${String(Math.round(threshold * 100))}% sure of.`
          }
        >
          <div className="segmented" role="radiogroup" aria-label="Sensitivity">
            {SENSITIVITY_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={preset?.id === p.id}
                className="segmented-item"
                onClick={() => {
                  setThreshold(p.threshold)
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Row>
        <Row
          label="Minimum confidence"
          htmlFor="threshold"
          hint="The exact cut-off behind the presets. Lower finds more."
        >
          <div className="range-field">
            <input
              id="threshold"
              type="range"
              min={0.05}
              max={0.95}
              step={0.05}
              value={threshold}
              onChange={(e) => {
                setThreshold(Number.parseFloat(e.currentTarget.value))
              }}
            />
            <span className="mono range-value">{threshold.toFixed(2)}</span>
          </div>
        </Row>
      </div>

      <div className="setting-group">
        <div className="setting-group-head">
          <span className="setting-label">Recognition model</span>
          <p className="setting-hint">
            GLiNER-PII finds names, organizations, places, dates and ID numbers, and Sanctum then
            marks every repeat of a name it found. The model ships inside the app and runs entirely
            on this computer.
          </p>
        </div>
      </div>

      <div className={`apply-bar${dirty ? ' is-dirty' : ''}`}>
        <p className="setting-hint">
          {restarting
            ? 'Restarting the detection engine…'
            : dirty
              ? 'Applying restarts the detection engine. A review in progress is kept.'
              : 'Engine is using these settings.'}
        </p>
        {error !== null ? (
          <p className="field-error" role="alert">
            Could not save: {error}
          </p>
        ) : null}
        <div className="apply-bar-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!dirty || saving}
            onClick={() => {
              setThreshold(settings.scoreThreshold)
            }}
          >
            Revert
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || saving}
            onClick={apply}
          >
            {saving ? 'Applying…' : 'Apply and restart engine'}
          </button>
        </div>
      </div>
    </section>
  )
}

function ChoiceCard({
  checked,
  onSelect,
  title,
  meta,
  body,
}: {
  readonly checked: boolean
  readonly onSelect: () => void
  readonly title: string
  readonly meta: string
  readonly body: string
}): ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className={`choice-card${checked ? ' is-checked' : ''}`}
      onClick={onSelect}
    >
      <span className="choice-card-head">
        <span className="radio-dot" aria-hidden="true" />
        <span className="choice-card-title">{title}</span>
        <span className="choice-card-meta">{meta}</span>
      </span>
      <span className="choice-card-body">{body}</span>
    </button>
  )
}

/* ----------------------------------------------------------------- Entities */

function EntitiesSection({
  settings,
  onChange,
}: {
  readonly settings: AppSettings
  readonly onChange: (patch: Partial<AppSettings>) => Promise<void>
}): ReactElement {
  const selected = new Set(settings.entityTypes ?? ALL_ENTITY_TYPES)
  const [error, setError] = useState<string | null>(null)

  const save = (next: Set<string>): void => {
    if (next.size === 0) {
      setError('Keep at least one type selected, or Sanctum has nothing to look for.')
      return
    }
    setError(null)
    const all = ALL_ENTITY_TYPES.every((t) => next.has(t))
    void onChange({ entityTypes: all ? null : ALL_ENTITY_TYPES.filter((t) => next.has(t)) })
  }

  const toggleType = (type: string): void => {
    const next = new Set(selected)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    save(next)
  }

  const toggleGroup = (types: readonly string[], on: boolean): void => {
    const next = new Set(selected)
    for (const t of types) {
      if (on) next.add(t)
      else next.delete(t)
    }
    save(next)
  }

  return (
    <section>
      <SectionHeader
        title="What to find"
        lede="The kinds of personal data Sanctum flags. Turning a type off means it is never flagged, so you would have to mark any occurrences yourself."
      />
      <div className="setting-toolbar">
        <span className="setting-hint">
          {settings.entityTypes === null
            ? 'Finding every supported type.'
            : `Finding ${String(selected.size)} of ${String(ALL_ENTITY_TYPES.length)} types.`}
        </span>
        <button
          type="button"
          className="link-button"
          disabled={settings.entityTypes === null}
          onClick={() => {
            setError(null)
            void onChange({ entityTypes: null })
          }}
        >
          Select all
        </button>
      </div>
      {error !== null ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="setting-group">
        {ENTITY_GROUPS.map((g) => {
          const on = g.types.filter((t) => selected.has(t)).length
          const all = on === g.types.length
          return (
            <div key={g.id} className="entity-group">
              <div className="entity-group-head">
                <input
                  id={`entity-group-${g.id}`}
                  type="checkbox"
                  checked={all}
                  ref={(el) => {
                    if (el !== null) el.indeterminate = on > 0 && !all
                  }}
                  onChange={() => {
                    toggleGroup(g.types, !all)
                  }}
                />
                <label className="entity-group-text" htmlFor={`entity-group-${g.id}`}>
                  <span className="setting-label">{g.label}</span>
                  <span className="setting-hint">{g.hint}</span>
                </label>
              </div>
              {g.types.length > 1 ? (
                <div className="chip-row">
                  {g.types.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="chip"
                      aria-pressed={selected.has(t)}
                      onClick={() => {
                        toggleType(t)
                      }}
                    >
                      {selected.has(t) ? <Icon name="check" size={12} /> : null}
                      {entityLabel(t)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* -------------------------------------------------------------- Replacement */

function ReplacementSection({
  settings,
  onChange,
}: {
  readonly settings: AppSettings
  readonly onChange: (patch: Partial<AppSettings>) => Promise<void>
}): ReactElement {
  const [text, setText] = useState(settings.replacementText)
  useEffect(() => {
    setText(settings.replacementText)
  }, [settings.replacementText])

  const fixed = settings.replacementStyle === 'fixed'
  const sample = (tag: string): string => (fixed ? text || '[REDACTED]' : `<${tag}>`)

  return (
    <section>
      <SectionHeader
        title="Replacement text"
        lede="What goes in place of each redacted item. You can still change any single replacement while reviewing."
      />
      <div className="choice-cards" role="radiogroup" aria-label="Replacement style">
        <ChoiceCard
          checked={!fixed}
          onSelect={() => {
            void onChange({ replacementStyle: 'label' })
          }}
          title="Say what was removed"
          meta="<PERSON>"
          body="Each item becomes its type, so the reader can still follow who did what."
        />
        <ChoiceCard
          checked={fixed}
          onSelect={() => {
            void onChange({ replacementStyle: 'fixed' })
          }}
          title="Same text everywhere"
          meta={settings.replacementText}
          body="Every item becomes the same marker. Reveals the least about the original."
        />
      </div>
      {fixed ? (
        <div className="setting-group">
          <Row label="Marker text" htmlFor="replacement-text">
            <input
              id="replacement-text"
              className="input input-mono"
              type="text"
              value={text}
              maxLength={40}
              onChange={(e) => {
                setText(e.currentTarget.value)
              }}
              onBlur={() => {
                const next = text.trim() === '' ? '[REDACTED]' : text.trim()
                setText(next)
                if (next !== settings.replacementText) void onChange({ replacementText: next })
              }}
            />
          </Row>
        </div>
      ) : null}
      <figure className="sample">
        <figcaption className="setting-hint">Preview</figcaption>
        <p className="sample-text">
          This Agreement is made between <span className="token">{sample('PERSON')}</span>, on
          behalf of <span className="token">{sample('ORGANIZATION')}</span>, and dated{' '}
          <span className="token">{sample('DATE_TIME')}</span>.
        </p>
      </figure>
    </section>
  )
}

/* ------------------------------------------------------------------- Saving */

function SavingSection({
  settings,
  onChange,
}: {
  readonly settings: AppSettings
  readonly onChange: (patch: Partial<AppSettings>) => Promise<void>
}): ReactElement {
  const [suffix, setSuffix] = useState(settings.outputSuffix)
  useEffect(() => {
    setSuffix(settings.outputSuffix)
  }, [settings.outputSuffix])

  return (
    <section>
      <SectionHeader
        title="Saving"
        lede="Where redacted copies go and what they are called. The original document is never changed."
      />
      <div className="setting-group">
        <Row
          label="File name ending"
          htmlFor="suffix"
          hint={
            <>
              Example:{' '}
              <span className="mono">{suggestedOutputName('Client NDA.docx', suffix)}</span>
            </>
          }
        >
          <input
            id="suffix"
            className="input input-mono"
            type="text"
            value={suffix}
            maxLength={40}
            onChange={(e) => {
              setSuffix(e.currentTarget.value.replace(/[/\\:]/g, ''))
            }}
            onBlur={() => {
              const next = suffix.trim() === '' ? '_anonymized' : suffix.trim()
              setSuffix(next)
              if (next !== settings.outputSuffix) void onChange({ outputSuffix: next })
            }}
          />
        </Row>
        <Row
          label="Save next to the original"
          hint="The save dialog opens in the original document's folder. Turn off to start from the last folder you used."
        >
          <Switch
            label="Save next to the original"
            checked={settings.saveNextToOriginal}
            onChange={(v) => {
              void onChange({ saveNextToOriginal: v })
            }}
          />
        </Row>
      </div>
    </section>
  )
}

function Switch({
  checked,
  onChange,
  label,
}: {
  readonly checked: boolean
  readonly onChange: (value: boolean) => void
  readonly label: string
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => {
        onChange(!checked)
      }}
    >
      <span className="switch-thumb" aria-hidden="true" />
    </button>
  )
}

/* --------------------------------------------------------------- Appearance */

function AppearanceSection({
  settings,
  onChange,
}: {
  readonly settings: AppSettings
  readonly onChange: (patch: Partial<AppSettings>) => Promise<void>
}): ReactElement {
  const options: readonly { id: ThemePreference; label: string }[] = [
    { id: 'system', label: 'Match system' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ]
  return (
    <section>
      <SectionHeader
        title="Appearance"
        lede="Documents always show on a white page, so what you see matches what you save."
      />
      <div className="setting-group">
        <Row label="Theme">
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={settings.theme === o.id}
                className="segmented-item"
                onClick={() => {
                  void onChange({ theme: o.id })
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Row>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- Keyboard */

export const APP_SHORTCUTS: readonly {
  readonly keys: readonly string[]
  readonly label: string
}[] = [
  { keys: ['⌘', 'K'], label: 'Command palette' },
  { keys: ['⌘', 'O'], label: 'Open document' },
  { keys: ['⌘', ','], label: 'Settings' },
  { keys: ['⌘', '\\'], label: 'Show or hide the sidebar' },
  { keys: ['esc'], label: 'Close the current panel or clear the selection' },
]

function KeyboardSection(): ReactElement {
  return (
    <section>
      <SectionHeader
        title="Keyboard"
        lede="Review a whole document without touching the mouse. Letter keys pause while you type in a field."
      />
      <div className="setting-group">
        <div className="setting-group-head">
          <span className="setting-label">Reviewing</span>
        </div>
        <ShortcutTable
          rows={[
            ...REVIEW_SHORTCUTS.filter((s) => s.keys[0] !== '⌘'),
            { keys: ['Tab'], label: 'Next detection (when nothing else has focus)' },
            { keys: ['⇧', 'R'], label: 'Keep all of this type' },
          ]}
        />
      </div>
      <div className="setting-group">
        <div className="setting-group-head">
          <span className="setting-label">Everywhere</span>
        </div>
        <ShortcutTable
          rows={[
            ...APP_SHORTCUTS,
            { keys: ['⌘', 'Z'], label: 'Undo last decision' },
            { keys: ['⌘', 'S'], label: 'Save redacted copy' },
          ]}
        />
      </div>
    </section>
  )
}

function ShortcutTable({
  rows,
}: {
  readonly rows: readonly { readonly keys: readonly string[]; readonly label: string }[]
}): ReactElement {
  return (
    <dl className="shortcut-list shortcut-list-wide">
      {rows.map((r) => (
        <div key={r.label} className="shortcut-row">
          <dt>{r.label}</dt>
          <dd>
            <Kbd keys={r.keys} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* ------------------------------------------------------------------ Privacy */

function PrivacySection({ status }: { readonly status: SanctumStatus }): ReactElement {
  const commit = status.state === 'ready' ? status.health.sanctum_commit : undefined
  return (
    <section>
      <SectionHeader
        title="Privacy"
        lede="Sanctum is built so your documents stay on this computer."
      />
      <ul className="facts">
        <li>
          <span className={`trust-dot trust-dot-${status.state}`} aria-hidden="true" />
          <div>
            <p className="setting-label">Detection runs on this computer</p>
            <p className="setting-hint">
              The engine is a local process that only accepts connections from this app.{' '}
              {engineLabel(status)}.
            </p>
          </div>
        </li>
        <li>
          <Icon name="lock" />
          <div>
            <p className="setting-label">No network access while you work</p>
            <p className="setting-hint">
              The app blocks every connection except to its own engine. Nothing you open is
              uploaded, logged remotely or used for training.
            </p>
          </div>
        </li>
        <li>
          <Icon name="doc" />
          <div>
            <p className="setting-label">Originals are never modified</p>
            <p className="setting-hint">
              Saving always writes a new file. Closing a document without saving discards the
              review.
            </p>
          </div>
        </li>
      </ul>
      {commit !== undefined ? (
        <p className="setting-hint mono">Engine build {commit.slice(0, 12)}</p>
      ) : null}
    </section>
  )
}
