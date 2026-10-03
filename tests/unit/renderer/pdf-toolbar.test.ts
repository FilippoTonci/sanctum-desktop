// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { PdfZoomControl } from '../../../src/renderer/src/components/PdfView'
import { ReviewToolbar } from '../../../src/renderer/src/components/ReviewToolbar'

afterEach(() => {
  cleanup()
})

describe('PDF zoom in the review toolbar', () => {
  it('renders view-specific controls in the toolbar slot', () => {
    const { getByRole } = render(
      React.createElement(ReviewToolbar, {
        fileName: 'letter.pdf',
        fileSize: 2048,
        onClose: vi.fn(),
        onUndo: vi.fn(),
        extra: React.createElement(PdfZoomControl, { value: 'fit', onChange: vi.fn() }),
      }),
    )
    const group = getByRole('radiogroup', { name: 'Zoom' })
    expect(group.closest('.toolbar')).not.toBeNull()
    expect(getByRole('radio', { name: 'Fit' }).getAttribute('aria-checked')).toBe('true')
  })

  it('has no slot when the view brings no controls', () => {
    const { container } = render(
      React.createElement(ReviewToolbar, {
        fileName: 'memo.docx',
        fileSize: 2048,
        onClose: vi.fn(),
        onUndo: vi.fn(),
      }),
    )
    expect(container.querySelector('.toolbar-extra')).toBeNull()
  })

  it('reports the chosen zoom mode', async () => {
    const onChange = vi.fn()
    const { getByRole } = render(React.createElement(PdfZoomControl, { value: 'fit', onChange }))
    await userEvent.click(getByRole('radio', { name: '150%' }))
    expect(onChange).toHaveBeenCalledWith('150')
  })
})
