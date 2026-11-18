/**
 * Shortcut labels for the platform the app runs on.
 *
 * Hints are written once, with Mac symbols (⌘S, ⇧A, ⌫). The keys themselves
 * already work everywhere: menu accelerators use CmdOrCtrl and the in-app
 * handlers accept Ctrl or ⌘. Only the labels need translating, and they all
 * pass through here: `Kbd` for key chips, `shortcut()` for tooltip text.
 */

const PC_LABELS: Readonly<Record<string, string>> = {
  '⌘': 'Ctrl',
  '⇧': 'Shift',
  '⌥': 'Alt',
  '⌃': 'Ctrl',
  '⌫': 'Backspace',
  '↵': 'Enter',
}

/** True on macOS. Electron's renderer reports the host OS in the user agent. */
export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
}

/** One key chip: "⌘" stays "⌘" on a Mac and becomes "Ctrl" elsewhere. */
export function keyLabel(key: string, mac: boolean = isMac()): string {
  return mac ? key : (PC_LABELS[key] ?? key)
}

/**
 * A shortcut inside running text: "⌘S" stays "⌘S" on a Mac and becomes
 * "Ctrl+S" elsewhere ("⇧⌘Z" -> "Shift+Ctrl+Z").
 */
export function shortcut(text: string, mac: boolean = isMac()): string {
  if (mac) return text
  return text
    .replace(/[⌘⇧⌥⌃]/gu, (c) => `${PC_LABELS[c] ?? c}+`)
    .replace(/[⌫↵]/gu, (c) => PC_LABELS[c] ?? c)
}
