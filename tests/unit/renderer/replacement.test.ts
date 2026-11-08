import { describe, expect, it } from 'vitest'
import {
  sessionOperatorFor,
  sessionRequestFromSettings,
} from '../../../src/renderer/src/review/replacement'
import type { AppSettings } from '../../../src/renderer/src/sanctum'

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

describe('sessionOperatorFor', () => {
  it('maps each replacement style onto an engine operator', () => {
    expect(sessionOperatorFor('label')).toEqual({ operator: 'replace' })
    expect(sessionOperatorFor('fixed', '[X]')).toEqual({
      operator: 'replace',
      params: { new_value: '[X]' },
    })
    expect(sessionOperatorFor('fake')).toEqual({ operator: 'hips' })
  })

  it('falls back to the default marker when the fixed text is blank', () => {
    expect(sessionOperatorFor('fixed', '   ')).toEqual({
      operator: 'replace',
      params: { new_value: '[REDACTED]' },
    })
  })
})

describe('sessionRequestFromSettings', () => {
  it('uses entity-tag labels when settings are unavailable', () => {
    expect(sessionRequestFromSettings('/doc.docx', null)).toEqual({
      input_path: '/doc.docx',
      default_operator: 'replace',
    })
  })

  it('sends no params for the label style', () => {
    expect(sessionRequestFromSettings('/doc.docx', SETTINGS)).toEqual({
      input_path: '/doc.docx',
      default_operator: 'replace',
    })
  })

  it('sends the marker text for the fixed style', () => {
    const req = sessionRequestFromSettings('/doc.docx', {
      ...SETTINGS,
      replacementStyle: 'fixed',
      replacementText: '[SEALED]',
    })
    expect(req.default_operator).toBe('replace')
    expect(req.default_operator_params).toEqual({ new_value: '[SEALED]' })
  })

  it('creates a hips session for fake data', () => {
    const req = sessionRequestFromSettings('/doc.docx', { ...SETTINGS, replacementStyle: 'fake' })
    expect(req.default_operator).toBe('hips')
    expect(req.default_operator_params).toBeUndefined()
  })

  it('ignores the fixed text unless the fixed style is chosen', () => {
    const req = sessionRequestFromSettings('/doc.docx', {
      ...SETTINGS,
      replacementStyle: 'fake',
      replacementText: '[SEALED]',
    })
    expect(req.default_operator_params).toBeUndefined()
  })

  it('passes the entity filter through when one is set', () => {
    const req = sessionRequestFromSettings('/doc.docx', {
      ...SETTINGS,
      replacementStyle: 'fake',
      entityTypes: ['PERSON', 'EMAIL_ADDRESS'],
    })
    expect(req.entities).toEqual(['PERSON', 'EMAIL_ADDRESS'])
  })
})
