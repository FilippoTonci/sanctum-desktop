export interface UndoDeps {
  /** True when a text field has focus. */
  readonly inputFocused: boolean
  /** True while a confirm dialog or the commit panel is open. */
  readonly blocked: boolean
  readonly undoStackSize: number
  readonly nativeUndo: () => void
  readonly undoDecision: () => void
}

/**
 * Menu Undo. A focused text field always gets its own native undo, even
 * inside the commit panel or a confirm dialog; otherwise it reverts the last
 * review decision, unless an overlay is blocking the review surface.
 */
export function runMenuUndo(d: UndoDeps): void {
  if (d.inputFocused) d.nativeUndo()
  else if (!d.blocked && d.undoStackSize > 0) d.undoDecision()
}
