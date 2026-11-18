// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import React from 'react'
import { Kbd } from '../../../src/renderer/src/components/Icon'
import { isMac, keyLabel, shortcut } from '../../../src/renderer/src/shortcuts'

describe('shortcut labels', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps Mac symbols on a Mac', () => {
    expect(keyLabel('⌘', true)).toBe('⌘')
    expect(shortcut('⌘S', true)).toBe('⌘S')
  })

  it('spells keys out on Windows and Linux', () => {
    expect(['⌘', '⇧', '⌥', '⌫', '↵', 'A'].map((k) => keyLabel(k, false))).toEqual([
      'Ctrl',
      'Shift',
      'Alt',
      'Backspace',
      'Enter',
      'A',
    ])
    expect(shortcut('⌘S', false)).toBe('Ctrl+S')
    expect(shortcut('⇧⌘Z', false)).toBe('Shift+Ctrl+Z')
    expect(shortcut('⌘\\', false)).toBe('Ctrl+\\')
    expect(shortcut('Keep original (⌫)', false)).toBe('Keep original (Backspace)')
  })

  it('reads the platform from the user agent', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Electron/33' })
    expect(isMac()).toBe(false)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
    expect(isMac()).toBe(true)
  })

  it('renders key chips for the platform', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Electron/33' })
    const { container } = render(React.createElement(Kbd, { keys: ['⌘', 'S'] }))
    expect([...container.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Ctrl', 'S'])
  })
})
