import { describe, expect, it, vi } from 'vitest'
import { buildMenuTemplate } from '../../../src/main/menu'

function find(template: Electron.MenuItemConstructorOptions[], label: string) {
  for (const top of template) {
    const items = (top.submenu ?? []) as Electron.MenuItemConstructorOptions[]
    const hit = items.find((i) => i.label === label)
    if (hit) return hit
  }
  throw new Error(`no menu item ${label}`)
}

describe('menu', () => {
  it('wires the document shortcuts to renderer commands', () => {
    const send = vi.fn()
    const t = buildMenuTemplate(send, 'darwin')
    for (const [label, accel, cmd] of [
      ['Open…', 'CmdOrCtrl+O', 'open'],
      ['Close', 'CmdOrCtrl+W', 'close'],
      ['Save Redacted Copy…', 'CmdOrCtrl+S', 'save'],
      ['Command Palette…', 'CmdOrCtrl+K', 'palette'],
    ] as const) {
      const item = find(t, label)
      expect(item.accelerator).toBe(accel)
      ;(item.click as () => void)()
      expect(send).toHaveBeenLastCalledWith(cmd)
    }
  })

  it('puts Settings in the app menu on macOS', () => {
    const t = buildMenuTemplate(vi.fn(), 'darwin')
    expect(find(t, 'Settings…').accelerator).toBe('CmdOrCtrl+,')
  })

  it('sends undo as a command instead of the native undo role', () => {
    const send = vi.fn()
    const item = find(buildMenuTemplate(send, 'darwin'), 'Undo')
    expect(item.role).toBeUndefined()
    expect(item.accelerator).toBe('CmdOrCtrl+Z')
    ;(item.click as () => void)()
    expect(send).toHaveBeenLastCalledWith('undo')
  })

  it('sends toggle-sidebar and settings, and has no native-only items', () => {
    const send = vi.fn()
    const t = buildMenuTemplate(send, 'darwin')
    ;(find(t, 'Toggle Sidebar').click as () => void)()
    expect(send).toHaveBeenLastCalledWith('toggle-sidebar')
    ;(find(t, 'Settings…').click as () => void)()
    expect(send).toHaveBeenLastCalledWith('settings')
    expect(() => find(t, 'Show Original')).toThrow()
    expect(() => find(t, 'Show Redacted')).toThrow()
  })

  it('puts Settings in File on other platforms', () => {
    const t = buildMenuTemplate(vi.fn(), 'linux')
    expect(t[0]?.label).toBe('File')
    expect(find(t, 'Settings…').accelerator).toBe('CmdOrCtrl+,')
  })
})
