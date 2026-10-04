import type { MenuItemConstructorOptions } from 'electron'

/** Keep in sync with the copies in src/preload/index.ts and src/renderer/src/sanctum.d.ts. */
/** Commands the menu forwards to the renderer, which owns the review state. */
export const MENU_COMMANDS = [
  'open',
  'close',
  'save',
  'settings',
  'undo',
  'toggle-sidebar',
  'palette',
] as const

export type MenuCommand = (typeof MENU_COMMANDS)[number]

/**
 * The application menu: standard Mac key equivalents, with every document
 * command forwarded to the renderer through `send`. Edit's Undo is a command
 * rather than the native role because studio's undo reverts a review decision.
 */
export function buildMenuTemplate(
  send: (cmd: MenuCommand) => void,
  platform: NodeJS.Platform,
): MenuItemConstructorOptions[] {
  const isMac = platform === 'darwin'
  const settings: MenuItemConstructorOptions = {
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: () => {
      send('settings')
    },
  }
  return [
    ...(isMac
      ? [
          {
            label: 'Sanctum',
            submenu: [
              { role: 'about' as const, label: 'About Sanctum' },
              { type: 'separator' as const },
              settings,
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const, label: 'Hide Sanctum' },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'Quit Sanctum' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            send('open')
          },
        },
        { type: 'separator' },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            send('close')
          },
        },
        {
          label: 'Save Redacted Copy…',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            send('save')
          },
        },
        ...(isMac
          ? []
          : [
              { type: 'separator' as const },
              settings,
              { type: 'separator' as const },
              { role: 'quit' as const },
            ]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => {
            send('undo')
          },
        },
        { role: 'redo', accelerator: 'Shift+CmdOrCtrl+Z' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette…',
          accelerator: 'CmdOrCtrl+K',
          click: () => {
            send('palette')
          },
        },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+\\',
          click: () => {
            send('toggle-sidebar')
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }],
    },
  ]
}
