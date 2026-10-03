import { describe, expect, it, vi } from 'vitest'
import { runMenuUndo } from '../../../src/renderer/src/menu-undo'

const mk = (o: Partial<Parameters<typeof runMenuUndo>[0]>) => ({
  inputFocused: false,
  blocked: false,
  undoStackSize: 1,
  nativeUndo: vi.fn(),
  undoDecision: vi.fn(),
  ...o,
})

describe('runMenuUndo', () => {
  it('runs native undo in a focused field even when an overlay is open', () => {
    const d = mk({ inputFocused: true, blocked: true })
    runMenuUndo(d)
    expect(d.nativeUndo).toHaveBeenCalled()
    expect(d.undoDecision).not.toHaveBeenCalled()
  })
  it('reverts a decision only when unblocked and non-empty', () => {
    const a = mk({})
    runMenuUndo(a)
    expect(a.undoDecision).toHaveBeenCalled()
    const b = mk({ blocked: true })
    runMenuUndo(b)
    expect(b.undoDecision).not.toHaveBeenCalled()
    const c = mk({ undoStackSize: 0 })
    runMenuUndo(c)
    expect(c.undoDecision).not.toHaveBeenCalled()
  })
})
