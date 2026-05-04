import { describe, expect, it } from 'vitest'
import { pickPreviewVariant } from '../../../src/renderer/src/components/InlinePreview'
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

describe('pickPreviewVariant', () => {
  it('returns null when there is no preview text', () => {
    expect(pickPreviewVariant(detection({ status: 'pending' }), 'd0', undefined)).toBeNull()
    expect(pickPreviewVariant(detection({ status: 'accepted' }), null, undefined)).toBeNull()
  })

  it('returns null for rejected detections regardless of focus', () => {
    expect(pickPreviewVariant(detection({ status: 'rejected', id: 'r0' }), 'r0', '<X>')).toBeNull()
    expect(pickPreviewVariant(detection({ status: 'rejected', id: 'r0' }), null, '<X>')).toBeNull()
  })

  it('returns "firm" for accepted detections', () => {
    expect(pickPreviewVariant(detection({ status: 'accepted', id: 'a0' }), null, '<X>')).toBe(
      'firm',
    )
    expect(pickPreviewVariant(detection({ status: 'accepted', id: 'a0' }), 'a0', '<X>')).toBe(
      'firm',
    )
  })

  it('returns "firm" for the focused pending detection and "faint" for unfocused pending', () => {
    expect(pickPreviewVariant(detection({ status: 'pending', id: 'p0' }), 'p0', '<X>')).toBe('firm')
    expect(pickPreviewVariant(detection({ status: 'pending', id: 'p0' }), 'p1', '<X>')).toBe(
      'faint',
    )
    expect(pickPreviewVariant(detection({ status: 'pending', id: 'p0' }), null, '<X>')).toBe(
      'faint',
    )
  })
})
