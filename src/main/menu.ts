import {
  app,
  Menu,
  nativeImage,
  shell,
  dialog,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron'
import type { Command } from '../shared/desktop'
import { t } from './i18n'

/*
 * macOS 26 menus show a symbol beside each command, a whole group or none of it (HIG Menus;
 * WWDC25 310). They are the system's own SF Symbols, drawn by AppKit at run time and never
 * copied into the app, which their licence allows only on Apple's platforms: elsewhere the menus
 * keep no icons.
 */
const symbol = (name: string) => {
  if (process.platform !== 'darwin') return {}
  const icon = nativeImage.createFromNamedImage(name)
  icon.setTemplateImage(true)
  return { icon }
}

export function installMenu(window: () => BrowserWindow | undefined) {
  app.setAboutPanelOptions({ applicationName: 'Yuki', applicationVersion: app.getVersion() })
  const guide = 'https://github.com/Institute-of-Agent-Life/Yuki-Desktop'
  const send = (command: Command) => () => window()?.webContents.send('yuki:command', command)
  const view: MenuItemConstructorOptions[] = [
    {
      label: t('menu:previousYuki'),
      ...symbol('chevron.backward'),
      accelerator: 'CmdOrCtrl+Shift+[',
      click: send('previous-character'),
    },
    {
      label: t('menu:nextYuki'),
      accelerator: 'CmdOrCtrl+Shift+]',
      click: send('next-character'),
      ...symbol('chevron.forward'),
    },
    { type: 'separator' },
    {
      label: t('menu:chat'),
      accelerator: 'CmdOrCtrl+1',
      click: send('chat'),
      ...symbol('bubble.left'),
    },
    {
      label: t('menu:works'),
      accelerator: 'CmdOrCtrl+2',
      click: send('works'),
      ...symbol('checklist'),
    },
    {
      label: t('menu:computer'),
      accelerator: 'CmdOrCtrl+3',
      click: send('computer'),
      ...symbol('desktopcomputer'),
    },
    {
      label: t('menu:local'),
      accelerator: 'CmdOrCtrl+6',
      click: send('local'),
      ...symbol('laptopcomputer'),
    },
    {
      label: t('menu:files'),
      accelerator: 'CmdOrCtrl+4',
      click: send('files'),
      ...symbol('folder'),
    },
    {
      label: t('menu:about'),
      accelerator: 'CmdOrCtrl+5',
      click: send('about'),
      ...symbol('person.crop.circle'),
    },
    { type: 'separator' },
    {
      label: t('menu:sidebar'),
      accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+S' : 'Ctrl+Shift+S',
      click: send('sidebar'),
      ...symbol('sidebar.left'),
    },
    {
      label: t('menu:inspector'),
      accelerator: 'Alt+CmdOrCtrl+I',
      click: send('inspector'),
      ...symbol('sidebar.right'),
    },
    {
      label: t('menu:focusMode'),
      accelerator: 'CmdOrCtrl+Shift+E',
      click: send('focus-mode'),
      ...symbol('rectangle.center.inset.filled'),
    },
    {
      label: t('menu:commandPalette'),
      accelerator: 'CmdOrCtrl+K',
      click: send('search'),
      ...symbol('command'),
    },
    {
      label: t('menu:find'),
      accelerator: 'CmdOrCtrl+F',
      click: send('find'),
      ...symbol('magnifyingglass'),
    },
    {
      label: t('menu:fullScreen'),
      role: 'togglefullscreen',
      ...symbol('arrow.up.left.and.arrow.down.right'),
    },
  ]
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: 'Yuki',
            submenu: [
              { label: t('menu:aboutApp'), role: 'about' as const, ...symbol('info.circle') },
              {
                label: t('menu:settings'),
                accelerator: 'CmdOrCtrl+,',
                click: send('settings'),
                ...symbol('gearshape'),
              },
              { type: 'separator' as const },
              { label: t('menu:hide'), role: 'hide' as const, ...symbol('eye.slash') },
              {
                label: t('menu:hideOthers'),
                role: 'hideOthers' as const,
                ...symbol('eye.slash.circle'),
              },
              { label: t('menu:quitApp'), role: 'quit' as const, ...symbol('power') },
            ],
          },
        ]
      : []),
    {
      label: t('menu:file'),
      submenu: [
        {
          label: t('menu:newMessage'),
          accelerator: 'CmdOrCtrl+N',
          click: send('focus-composer'),
          ...symbol('square.and.pencil'),
        },
        {
          label: t('menu:settings'),
          accelerator: 'CmdOrCtrl+,',
          click: send('settings'),
          ...symbol('gearshape'),
        },
        { label: t('menu:closeWindow'), role: 'close', ...symbol('xmark') },
        ...(process.platform === 'darwin'
          ? []
          : [{ type: 'separator' as const }, { label: t('menu:quit'), role: 'quit' as const }]),
      ],
    },
    {
      label: t('menu:edit'),
      submenu: [
        { label: t('common:edit.undo'), role: 'undo', ...symbol('arrow.uturn.backward') },
        { label: t('common:edit.redo'), role: 'redo', ...symbol('arrow.uturn.forward') },
        { type: 'separator' },
        { label: t('common:edit.cut'), role: 'cut', ...symbol('scissors') },
        { label: t('common:edit.copy'), role: 'copy', ...symbol('doc.on.doc') },
        { label: t('common:edit.paste'), role: 'paste', ...symbol('doc.on.clipboard') },
        {
          label: t('common:edit.selectAll'),
          role: 'selectAll',
          ...symbol('character.cursor.ibeam'),
        },
      ],
    },
    { label: t('menu:view'), submenu: view },
    {
      label: t('menu:window'),
      submenu: [
        { label: t('menu:minimize'), role: 'minimize', ...symbol('minus') },
        ...(process.platform === 'darwin'
          ? [
              {
                label: t('menu:zoom'),
                role: 'zoom' as const,
                ...symbol('plus.rectangle.on.rectangle'),
              },
              {
                label: t('menu:front'),
                role: 'front' as const,
                ...symbol('macwindow.on.rectangle'),
              },
            ]
          : [
              {
                label: t('menu:maximize'),
                click: () => {
                  const target = window()
                  if (!target || target.isDestroyed() || !target.isMaximizable()) return
                  if (target.isMaximized()) target.unmaximize()
                  else target.maximize()
                },
              },
            ]),
      ],
    },
    {
      label: t('menu:help'),
      role: 'help',
      submenu: [
        {
          label: t('menu:guide'),
          ...symbol('book'),
          click: () => {
            void shell.openExternal(guide).catch(() => {
              dialog.showErrorBox(
                t('menu:guideFailed'),
                t('menu:guideFailedDetail', { url: guide }),
              )
            })
          },
        },
        ...(process.platform === 'darwin'
          ? []
          : [{ label: t('menu:aboutApp'), click: () => app.showAboutPanel() }]),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
