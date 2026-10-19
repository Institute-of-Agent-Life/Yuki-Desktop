import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { Command } from '../shared/desktop'

export function installMenu(window: () => BrowserWindow | undefined) {
  const send = (command: Command) => () => window()?.webContents.send('yuki:command', command)
  const view: MenuItemConstructorOptions[] = [
    { label: '對話', accelerator: 'CmdOrCtrl+1', click: send('chat') },
    { label: '工作', accelerator: 'CmdOrCtrl+2', click: send('works') },
    { label: '電腦', accelerator: 'CmdOrCtrl+3', click: send('computer') },
    { label: '檔案與成果', accelerator: 'CmdOrCtrl+4', click: send('files') },
    { label: '關於角色', accelerator: 'CmdOrCtrl+5', click: send('about') },
    { type: 'separator' },
    {
      label: '側邊欄',
      accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+S' : 'Ctrl+Shift+S',
      click: send('sidebar'),
    },
    { label: '檢視器', accelerator: 'Alt+CmdOrCtrl+I', click: send('inspector') },
    { label: '展開工作區', accelerator: 'CmdOrCtrl+Shift+E', click: send('focus-mode') },
    { label: '指令面板', accelerator: 'CmdOrCtrl+K', click: send('search') },
    { label: '尋找', accelerator: 'CmdOrCtrl+F', click: send('find') },
    { role: 'togglefullscreen' },
  ]
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { label: '設定…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: '檔案',
      submenu: [
        { label: '新訊息', accelerator: 'CmdOrCtrl+N', click: send('focus-composer') },
        { label: '設定…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { role: 'close' },
      ],
    },
    {
      label: '編輯',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    { label: '顯示', submenu: view },
    { label: '視窗', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
