// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import React from 'react'
import {
  sampleReplacement,
  SettingsView,
  type OpenDocument,
} from '../../../src/renderer/src/components/SettingsView'
import type { AppSettings, ReplacementStyle } from '../../../src/renderer/src/sanctum'

const SETTINGS: AppSettings = {
  scoreThreshold: 0.35,
  defaultOperator: 'replace',
  entityTypes: null,
  replacementStyle: 'label',
  replacementText: '[REDACTED]',
  outputSuffix: '_anonymized',
  saveNextToOriginal: true,
  theme: 'system',
}

function renderSection(
  style: ReplacementStyle,
  onChange = vi.fn(() => Promise.resolve()),
  openDocument: OpenDocument | null = null,
  replacementText = SETTINGS.replacementText,
): ReturnType<typeof render> {
  return render(
    React.createElement(SettingsView, {
      settings: { ...SETTINGS, replacementStyle: style, replacementText },
      openDocument,
      status: { state: 'idle' },
      section: 'replacement',
      onSectionChange: vi.fn(),
      onChange,
      onClose: vi.fn(),
    }),
  )
}

describe('Settings → Replacement text', () => {
  afterEach(cleanup)

  it('offers all three replacement methods as one radio group', () => {
    const { getByRole } = renderSection('label')
    const group = getByRole('radiogroup', { name: 'Replacement style' })
    const titles = [...group.querySelectorAll('.choice-card-title')].map((n) => n.textContent)
    expect(titles).toEqual(['Say what was removed', 'Same text everywhere', 'Realistic fake data'])
  })

  it.each([
    ['Realistic fake data', 'fake'],
    ['Same text everywhere', 'fixed'],
  ] as const)('saves the %s choice as replacementStyle=%s', (title, style) => {
    const onChange = vi.fn(() => Promise.resolve())
    const { getByRole } = renderSection('label', onChange)
    fireEvent.click(getByRole('radio', { name: new RegExp(title) }))
    expect(onChange).toHaveBeenCalledWith({ replacementStyle: style })
  })

  it('marks only the current method as checked', () => {
    const { getByRole } = renderSection('fake')
    expect(getByRole('radio', { name: /Realistic fake data/ }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(getByRole('radio', { name: /Say what was removed/ }).getAttribute('aria-checked')).toBe(
      'false',
    )
  })

  it('shows the marker field only for the fixed method', () => {
    expect(renderSection('fixed').queryByLabelText('Marker text')).not.toBeNull()
    cleanup()
    expect(renderSection('fake').queryByLabelText('Marker text')).toBeNull()
  })

  it('labels the fake-data preview as example values', () => {
    const { getByTestId } = renderSection('fake')
    expect(getByTestId('replacement-sample').textContent).toContain('example values')
  })
})

describe('sampleReplacement', () => {
  const person = { original: 'Jane Doe', tag: 'PERSON' }

  it('renders each method in its own shape', () => {
    expect(sampleReplacement('label', person, '')).toBe('<PERSON>')
    expect(sampleReplacement('fixed', person, '[X]')).toBe('[X]')
    expect(sampleReplacement('fixed', person, '  ')).toBe('[REDACTED]')
    expect(sampleReplacement('fake', person, '')).toBe('Michael Jones')
  })
})

describe('Settings → Replacement text with a document open', () => {
  afterEach(cleanup)

  const doc = (
    operator: string,
    params: Record<string, unknown> = {},
    applyMethod: OpenDocument['applyMethod'] = vi.fn(() => Promise.resolve()),
  ): OpenDocument => ({ name: 'nda.docx', method: { operator, params }, applyMethod })

  it('says nothing about an open document when there is none', () => {
    expect(renderSection('fake').queryByTestId('open-document-method')).toBeNull()
  })

  it('confirms the open document already uses the chosen method', () => {
    const { getByTestId, queryByRole } = renderSection('fake', undefined, doc('hips'))
    expect(getByTestId('open-document-method').textContent).toContain(
      'The open document, nda.docx, uses realistic fake data.',
    )
    expect(queryByRole('button', { name: 'Apply to open document' })).toBeNull()
  })

  it('offers to switch an open document that uses another method', () => {
    const { getByTestId, getByRole } = renderSection('fake', undefined, doc('replace'))
    expect(getByTestId('open-document-method').textContent).toContain(
      'still uses entity tags such as <PERSON>. Applying keeps your decisions',
    )
    expect(getByRole('button', { name: 'Apply to open document' })).toBeTruthy()
  })

  it('treats another marker as another method', () => {
    const { getByRole } = renderSection(
      'fixed',
      undefined,
      doc('replace', { new_value: '[OLD]' }),
      '[NEW]',
    )
    expect(getByRole('button', { name: 'Apply to open document' })).toBeTruthy()
  })

  it.each([
    ['fake', '[REDACTED]', { operator: 'hips' }],
    ['label', '[REDACTED]', { operator: 'replace' }],
    ['fixed', '[NEW]', { operator: 'replace', params: { new_value: '[NEW]' } }],
  ] as const)('applies the %s method to the open document', (style, text, expected) => {
    const applyMethod = vi.fn(() => Promise.resolve())
    const open = doc(style === 'fake' ? 'replace' : 'hips', {}, applyMethod)
    const { getByRole } = renderSection(style, undefined, open, text)
    fireEvent.click(getByRole('button', { name: 'Apply to open document' }))
    expect(applyMethod).toHaveBeenCalledWith(expected)
  })

  it('shows progress while applying and prevents a second click', async () => {
    let finish = (): void => undefined
    const applyMethod = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const { getByRole } = renderSection('fake', undefined, doc('replace', {}, applyMethod))
    fireEvent.click(getByRole('button', { name: 'Apply to open document' }))
    const busy = getByRole('button', { name: 'Applying…' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(busy)
    expect(applyMethod).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => {
      expect(getByRole('button', { name: 'Apply to open document' })).toBeTruthy()
    })
  })

  it('shows why applying failed and lets the user retry', async () => {
    const applyMethod = vi
      .fn<OpenDocument['applyMethod']>()
      .mockRejectedValueOnce(new Error('session is committed'))
      .mockResolvedValueOnce(undefined)
    const { getByRole, findByRole } = renderSection(
      'fake',
      undefined,
      doc('replace', {}, applyMethod),
    )
    fireEvent.click(getByRole('button', { name: 'Apply to open document' }))
    expect((await findByRole('alert')).textContent).toBe('Could not apply: session is committed')
    fireEvent.click(getByRole('button', { name: 'Apply to open document' }))
    expect(applyMethod).toHaveBeenCalledTimes(2)
  })
})
