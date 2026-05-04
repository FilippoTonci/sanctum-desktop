import { describe, expect, it } from 'vitest'
import {
  pickFocusedControlsState,
  pickReplacementVariant,
} from '../../../src/renderer/src/components/DetectionSidebar'
import type { Detection } from '../../../src/renderer/src/review/types'

function detection(overrides: Partial<Detection>): Detection {
  return {
    id: 'd0',
    segmentId: 'body/p0/r0',
    start: 0,
    end: 5,
    text: 'Alice',
    entityType: 'PERSON',
    status: 'pending',
    ...overrides,
  }
}

describe('pickFocusedControlsState', () => {
  it('returns null for non-focused rows', () => {
    expect(
      pickFocusedControlsState(detection({ id: 'd0' }), 'd1', null, 'replace', false),
    ).toBeNull()
  })

  it('returns the read-mode shape for the focused row when not editing', () => {
    const state = pickFocusedControlsState(
      detection({ id: 'd0', operator: 'mask' }),
      'd0',
      null,
      'replace',
      true,
    )
    expect(state).not.toBeNull()
    expect(state!.editing).toBe(false)
    expect(state!.effectiveOperator).toBe('mask')
    expect(state!.pseudonymizeLocked).toBe(false)
    expect(state!.defaultOperator).toBe('replace')
  })

  it('falls back to the session default operator when none is set on the detection', () => {
    const state = pickFocusedControlsState(
      detection({ id: 'd0', operator: undefined }),
      'd0',
      null,
      'redact',
      true,
    )
    expect(state!.effectiveOperator).toBe('redact')
    expect(state!.defaultOperator).toBe('redact')
  })

  it('flips into edit mode when editingReplacementId matches', () => {
    const state = pickFocusedControlsState(detection({ id: 'd0' }), 'd0', 'd0', 'replace', true)
    expect(state!.editing).toBe(true)
    expect(state!.defaultOperator).toBe('replace')
  })

  it('marks pseudonymize as locked when the mapping store is locked', () => {
    const state = pickFocusedControlsState(
      detection({ id: 'd0', operator: 'pseudonymize' }),
      'd0',
      null,
      'replace',
      false,
    )
    expect(state!.pseudonymizeLocked).toBe(true)
    expect(state!.defaultOperator).toBe('replace')
  })
})

describe('pickReplacementVariant', () => {
  it('returns null when no preview is available', () => {
    expect(pickReplacementVariant(detection({ status: 'pending' }), undefined)).toBeNull()
    expect(pickReplacementVariant(detection({ status: 'accepted' }), undefined)).toBeNull()
  })

  it('returns "firm" for accepted detections with a preview', () => {
    expect(pickReplacementVariant(detection({ status: 'accepted' }), '<X>')).toBe('firm')
  })

  it('returns "muted" for rejected detections with a preview', () => {
    expect(pickReplacementVariant(detection({ status: 'rejected' }), '<X>')).toBe('muted')
  })

  it('returns "faint" for pending detections with a preview', () => {
    expect(pickReplacementVariant(detection({ status: 'pending' }), '<X>')).toBe('faint')
  })
})
