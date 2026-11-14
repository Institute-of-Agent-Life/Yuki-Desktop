import {
  app,
  Menu,
  shell,
  dialog,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron'
import type { Command } from '../shared/desktop'
import { t } from './i18n'

export function installMenu(window: () => BrowserWindow | undefined) {
  app.setAboutPanelOptions({ applicationName: 'Yuki', applicationVersion: app.getVersion() })
  const guide = 'https://github.com/Institute-of-Agent-Life/Yuki-Desktop'
  const send = (command: Command) => () => window()?.webContents.send('yuki:command', command)
  const view: MenuItemConstructorOptions[] = [
    {
      label: t('menu:previousYuki'),
      accelerator: 'CmdOrCtrl+Shift+[',
      click: send('previous-character'),
    },
    { label: t('menu:nextYuki'), accelerator: 'CmdOrCtrl+Shift+]', click: send('next-character') },
    { type: 'separator' },
    { label: t('menu:chat'), accelerator: 'CmdOrCtrl+1', click: send('chat') },
    { label: t('menu:works'), accelerator: 'CmdOrCtrl+2', click: send('works') },
    { label: t('menu:computer'), accelerator: 'CmdOrCtrl+3', click: send('computer') },
    { label: t('menu:local'), accelerator: 'CmdOrCtrl+6', click: send('local') },
    { label: t('menu:files'), accelerator: 'CmdOrCtrl+4', click: send('files') },
    { label: t('menu:about'), accelerator: 'CmdOrCtrl+5', click: send('about') },
    { type: 'separator' },
    {
      label: t('menu:sidebar'),
      accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+S' : 'Ctrl+Shift+S',
      click: send('sidebar'),
    },
    { label: t('menu:inspector'), accelerator: 'Alt+CmdOrCtrl+I', click: send('inspector') },
    { label: t('menu:focusMode'), accelerator: 'CmdOrCtrl+Shift+E', click: send('focus-mode') },
    { label: t('menu:commandPalette'), accelerator: 'CmdOrCtrl+K', click: send('search') },
    { label: t('menu:find'), accelerator: 'CmdOrCtrl+F', click: send('find') },
    { label: t('menu:fullScreen'), role: 'togglefullscreen' },
  ]
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: 'Yuki',
            submenu: [
              { label: t('menu:aboutApp'), role: 'about' as const },
              { label: t('menu:settings'), accelerator: 'CmdOrCtrl+,', click: send('settings') },
              { type: 'separator' as const },
              { label: t('menu:hide'), role: 'hide' as const },
              { label: t('menu:hideOthers'), role: 'hideOthers' as const },
              { label: t('menu:quitApp'), role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: t('menu:file'),
      submenu: [
        { label: t('menu:newMessage'), accelerator: 'CmdOrCtrl+N', click: send('focus-composer') },
        { label: t('menu:settings'), accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { label: t('menu:closeWindow'), role: 'close' },
        ...(process.platform === 'darwin'
          ? []
          : [{ type: 'separator' as const }, { label: t('menu:quit'), role: 'quit' as const }]),
      ],
    },
    {
      label: t('menu:edit'),
      submenu: [
        { label: t('common:edit.undo'), role: 'undo' },
        { label: t('common:edit.redo'), role: 'redo' },
        { type: 'separator' },
        { label: t('common:edit.cut'), role: 'cut' },
        { label: t('common:edit.copy'), role: 'copy' },
        { label: t('common:edit.paste'), role: 'paste' },
        { label: t('common:edit.selectAll'), role: 'selectAll' },
      ],
    },
    { label: t('menu:view'), submenu: view },
    {
      label: t('menu:window'),
      submenu: [
        { label: t('menu:minimize'), role: 'minimize' },
        ...(process.platform === 'darwin'
          ? [
              { label: t('menu:zoom'), role: 'zoom' as const },
              { label: t('menu:front'), role: 'front' as const },
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
