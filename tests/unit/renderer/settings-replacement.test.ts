// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import React from 'react'
import { sampleReplacement, SettingsView } from '../../../src/renderer/src/components/SettingsView'
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
): ReturnType<typeof render> {
  return render(
    React.createElement(SettingsView, {
      settings: { ...SETTINGS, replacementStyle: style },
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

  it('offers all five replacement methods as one radio group', () => {
    const { getByRole } = renderSection('label')
    const group = getByRole('radiogroup', { name: 'Replacement style' })
    const titles = [...group.querySelectorAll('.choice-card-title')].map((n) => n.textContent)
    expect(titles).toEqual([
      'Say what was removed',
      'Same text everywhere',
      'Realistic fake data',
      'Mask every character',
      'Remove the text',
    ])
  })

  it.each([
    ['Realistic fake data', 'fake'],
    ['Mask every character', 'mask'],
    ['Remove the text', 'remove'],
    ['Same text everywhere', 'fixed'],
  ] as const)('saves the %s choice as replacementStyle=%s', (title, style) => {
    const onChange = vi.fn(() => Promise.resolve())
    const { getByRole } = renderSection('label', onChange)
    fireEvent.click(getByRole('radio', { name: new RegExp(title) }))
    expect(onChange).toHaveBeenCalledWith({ replacementStyle: style })
  })

  it('marks only the current method as checked', () => {
    const { getByRole } = renderSection('mask')
    expect(getByRole('radio', { name: /Mask every character/ }).getAttribute('aria-checked')).toBe(
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

  it('previews masking with one * per character', () => {
    const { getByTestId } = renderSection('mask')
    expect(getByTestId('replacement-sample').textContent).toContain(
      'between ********, on behalf of ********, and dated *************.',
    )
  })

  it('previews removal as a gap, with no empty chips', () => {
    const { getByTestId } = renderSection('remove')
    const sample = getByTestId('replacement-sample')
    expect(sample.querySelectorAll('.token')).toHaveLength(0)
    expect(sample.textContent).toContain(
      'This Agreement is made between , on behalf of , and dated .',
    )
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
    expect(sampleReplacement('mask', person, '')).toBe('********')
    expect(sampleReplacement('remove', person, '')).toBe('')
  })
})
