// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import React from 'react'
import { Inspector } from '../../../src/renderer/src/components/Inspector'
import { useReviewStore } from '../../../src/renderer/src/review/store'
import type { Detection } from '../../../src/renderer/src/review/types'

vi.mock('../../../src/renderer/src/review/use-actions', () => ({
  useReviewActions: () => ({
    accept: vi.fn(),
    reject: vi.fn(),
    setOperator: vi.fn(),
    setCustomReplacement: vi.fn(),
    addMissed: vi.fn(),
    addMissedAndWait: vi.fn(),
    undoLastDecision: vi.fn(),
  }),
}))

function show(status: Detection['status']): void {
  const d: Detection = {
    id: 'd0',
    segmentId: 'body/p0/r0',
    start: 0,
    end: 5,
    text: 'Alice',
    entityType: 'PERSON',
    status,
  }
  useReviewStore.getState().setDetections([d])
  useReviewStore.getState().setFocused('d0')
}

describe('Inspector verdict buttons', () => {
  beforeEach(() => {
    useReviewStore.getState().clear()
  })
  afterEach(cleanup)

  it('shows Redact as pressed and reads "Redacted" when accepted', () => {
    show('accepted')
    const { getByRole } = render(React.createElement(Inspector))
    const redact = getByRole('button', { name: /^Redacted/ })
    expect(redact.getAttribute('aria-pressed')).toBe('true')
    expect(redact.className).toContain('is-active')
    expect(getByRole('button', { name: /^Keep original/ }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('shows Keep original as pressed and reads "Original kept" when rejected', () => {
    show('rejected')
    const { getByRole } = render(React.createElement(Inspector))
    const keep = getByRole('button', { name: /^Original kept/ })
    expect(keep.getAttribute('aria-pressed')).toBe('true')
    expect(keep.className).toContain('is-active')
    expect(getByRole('button', { name: /^Redact(?! all)/ }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('leaves both unpressed while pending', () => {
    show('pending')
    const { getByRole } = render(React.createElement(Inspector))
    expect(getByRole('button', { name: /^Redact(?! all)/ }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(getByRole('button', { name: /^Keep original/ }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })
})
