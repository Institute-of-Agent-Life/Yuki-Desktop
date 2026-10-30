import {
  app,
  Menu,
  shell,
  dialog,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron'
import type { Command } from '../shared/desktop'

export function installMenu(window: () => BrowserWindow | undefined) {
  app.setAboutPanelOptions({ applicationName: 'Yuki', applicationVersion: app.getVersion() })
  const send = (command: Command) => () => window()?.webContents.send('yuki:command', command)
  const view: MenuItemConstructorOptions[] = [
    { label: '上一個 Yuki', accelerator: 'CmdOrCtrl+Shift+[', click: send('previous-character') },
    { label: '下一個 Yuki', accelerator: 'CmdOrCtrl+Shift+]', click: send('next-character') },
    { type: 'separator' },
    { label: '對話', accelerator: 'CmdOrCtrl+1', click: send('chat') },
    { label: '工作', accelerator: 'CmdOrCtrl+2', click: send('works') },
    { label: 'Yuki 的電腦', accelerator: 'CmdOrCtrl+3', click: send('computer') },
    { label: '這台電腦', accelerator: 'CmdOrCtrl+6', click: send('local') },
    { label: '檔案與成果', accelerator: 'CmdOrCtrl+4', click: send('files') },
    { label: '關於目前的 Yuki', accelerator: 'CmdOrCtrl+5', click: send('about') },
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
    { label: '切換全螢幕', role: 'togglefullscreen' },
  ]
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: 'Yuki',
            submenu: [
              { label: '關於 Yuki Desktop', role: 'about' as const },
              { label: '設定…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
              { type: 'separator' as const },
              { label: '隱藏 Yuki', role: 'hide' as const },
              { label: '隱藏其他', role: 'hideOthers' as const },
              { label: '結束 Yuki', role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: '檔案',
      submenu: [
        { label: '新訊息', accelerator: 'CmdOrCtrl+N', click: send('focus-composer') },
        { label: '設定…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { label: '關閉視窗', role: 'close' },
        ...(process.platform === 'darwin'
          ? []
          : [{ type: 'separator' as const }, { label: '結束', role: 'quit' as const }]),
      ],
    },
    {
      label: '編輯',
      submenu: [
        { label: '復原', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪下', role: 'cut' },
        { label: '複製', role: 'copy' },
        { label: '貼上', role: 'paste' },
        { label: '全選', role: 'selectAll' },
      ],
    },
    { label: '顯示', submenu: view },
    {
      label: '視窗',
      submenu: [
        { label: '最小化', role: 'minimize' },
        ...(process.platform === 'darwin'
          ? [
              { label: '縮放', role: 'zoom' as const },
              { label: '全部移到最前', role: 'front' as const },
            ]
          : [
              {
                label: '最大化／還原',
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
      label: '說明',
      role: 'help',
      submenu: [
        {
          label: '使用說明',
          click: () => {
            void shell
              .openExternal('https://github.com/Institute-of-Agent-Life/Yuki-Desktop')
              .catch(() => {
                dialog.showErrorBox(
                  '無法開啟使用說明',
                  '請在瀏覽器開啟 https://github.com/Institute-of-Agent-Life/Yuki-Desktop',
                )
              })
          },
        },
        ...(process.platform === 'darwin'
          ? []
          : [{ label: '關於 Yuki Desktop', click: () => app.showAboutPanel() }]),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
