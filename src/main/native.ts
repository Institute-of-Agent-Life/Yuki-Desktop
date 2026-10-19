import { app, Menu, nativeImage, Notification, Tray, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { Preferences, NavigationTarget } from '../shared/desktop'
import type { ClientNotice } from './notifications'

export class NativeShell {
  private tray: Tray | undefined
  private readonly notices = new Set<Notification>()
  selectedCharacter: string | undefined
  constructor(
    readonly window: () => BrowserWindow | undefined,
    readonly reveal: () => void,
    readonly open: (target: NavigationTarget) => void,
    readonly platform: NodeJS.Platform = process.platform,
  ) {}
  update(preferences: Preferences) {
    if (preferences.keepInTray && !this.tray) {
      const icon = nativeImage.createFromPath(
        join(
          app.getAppPath(),
          'resources/icons',
          this.platform === 'darwin' ? 'trayTemplate.png' : 'app/32x32.png',
        ),
      )
      if (this.platform === 'darwin') icon.setTemplateImage(true)
      this.tray = new Tray(icon)
      this.tray.setToolTip('Yuki')
      this.tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: '開啟 Yuki', click: this.reveal },
          { type: 'separator' },
          { label: '結束', click: () => app.quit() },
        ]),
      )
      this.tray.on('click', this.reveal)
      this.tray.on('double-click', this.reveal)
    } else if (!preferences.keepInTray && this.tray) {
      this.tray.destroy()
      this.tray = undefined
    }
  }
  show(notice: ClientNotice) {
    if (!Notification.isSupported()) return
    if (
      notice.category !== 'help' &&
      this.window()?.isFocused() &&
      this.selectedCharacter === notice.target.characterId
    )
      return
    const notification = new Notification({
      title: notice.title,
      body: notice.body,
      icon: join(app.getAppPath(), 'resources/icons/app/128x128.png'),
    })
    this.notices.add(notification)
    notification.once('click', () => {
      this.reveal()
      this.open(notice.target)
    })
    notification.once('close', () => this.notices.delete(notification))
    notification.once('failed', () => this.notices.delete(notification))
    notification.show()
  }
  close() {
    this.tray?.destroy()
    this.notices.forEach((notice) => notice.close())
    this.notices.clear()
  }
}
