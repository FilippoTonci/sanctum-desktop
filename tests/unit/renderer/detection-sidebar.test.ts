// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import {
  DetectionSidebar,
  pickFocusedControlsState,
  pickReplacementVariant,
} from '../../../src/renderer/src/components/DetectionSidebar'
import { useReviewStore } from '../../../src/renderer/src/review/store'
import type { Detection } from '../../../src/renderer/src/review/types'
import type { ReviewActions } from '../../../src/renderer/src/review/actions'

// Mock useReviewActions so component tests can inject spies without spinning
// up a real ReviewActionsProvider + SessionsClient.
vi.mock('../../../src/renderer/src/review/use-actions', () => {
  const mockActions: ReviewActions = {
    accept: vi.fn(),
    reject: vi.fn(),
    setOperator: vi.fn(),
    setCustomReplacement: vi.fn(),
    addMissed: vi.fn(),
    undoLastDecision: vi.fn(),
  }
  return {
    useReviewActions: () => mockActions,
    ReviewActionsProvider: ({ children }: { children: React.ReactNode }) => children,
  }
})

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

describe('+ Mark missed PII button', () => {
  beforeEach(() => {
    useReviewStore.getState().clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('is disabled when pendingMissedSelection is null', () => {
    const { getByRole } = render(React.createElement(DetectionSidebar))
    const btn = getByRole('button', { name: /Mark missed PII/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('is enabled when a pendingMissedSelection is set', () => {
    useReviewStore.getState().setPendingMissedSelection({
      locator: { segmentId: 'seg/0', start: 0, end: 5 },
      text: 'hello',
    })
    const { getByRole } = render(React.createElement(DetectionSidebar))
    const btn = getByRole('button', { name: /Mark missed PII/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it('calls actions.addMissed with the pending value when clicked', async () => {
    const pending = {
      locator: { segmentId: 'seg/0', start: 0, end: 5 },
      text: 'hello',
    }
    useReviewStore.getState().setPendingMissedSelection(pending)
    const { getByRole } = render(React.createElement(DetectionSidebar))
    const btn = getByRole('button', { name: /Mark missed PII/i })
    await userEvent.click(btn)
    // Get the mocked actions from the module
    const { useReviewActions } = await import('../../../src/renderer/src/review/use-actions')
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { addMissed } = useReviewActions()
    expect(vi.mocked(addMissed)).toHaveBeenCalledWith(pending)
  })
})

describe('DetectionSidebar focus scrolling', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    scrollIntoView.mockClear()
    // happy-dom does not implement scrollIntoView; install a spy.
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    useReviewStore.getState().clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('scrolls the focused row into view when focus changes', () => {
    useReviewStore
      .getState()
      .setDetections([detection({ id: 'a' }), detection({ id: 'b' }), detection({ id: 'c' })])
    render(React.createElement(DetectionSidebar))
    scrollIntoView.mockClear()

    act(() => {
      useReviewStore.getState().setFocused('c')
    })

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('does not scroll when there is no focused row', () => {
    useReviewStore.getState().setDetections([detection({ id: 'a' })])
    render(React.createElement(DetectionSidebar))
    scrollIntoView.mockClear()

    act(() => {
      useReviewStore.getState().setFocused(null)
    })

    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('DetectionSidebar unwrappable marker', () => {
  beforeEach(() => {
    useReviewStore.getState().clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('marks only the rows reported as unwrappable', () => {
    // Distinct `text` per row: the factory defaults every detection to
    // 'Alice', and the assertion below matches on rendered row text.
    useReviewStore
      .getState()
      .setDetections([detection({ id: 'a', text: 'Alice' }), detection({ id: 'b', text: 'Bob' })])
    useReviewStore.getState().setUnwrappableIds(['b'])
    const { container } = render(React.createElement(DetectionSidebar))

    const markers = container.querySelectorAll('.sidebar-item-unwrappable')
    expect(markers).toHaveLength(1)
    expect(markers[0]?.closest('li')?.textContent).toContain('Bob')
  })

  it('renders no marker when every detection wrapped cleanly', () => {
    useReviewStore.getState().setDetections([detection({ id: 'a' })])
    const { container } = render(React.createElement(DetectionSidebar))
    expect(container.querySelectorAll('.sidebar-item-unwrappable')).toHaveLength(0)
  })
})
