import {
  app,
  Menu,
  nativeImage,
  Notification,
  Tray,
  type BrowserWindow,
  type NativeImage,
} from 'electron'
import { join } from 'node:path'
import type { Preferences, NavigationTarget } from '../shared/desktop'
import type { ClientNotice } from './notifications'
import type { Profile } from '../shared/api'

export class NativeShell {
  private tray: Tray | undefined
  private fallbackIcon: NativeImage | undefined
  private readonly notices = new Set<Notification>()
  private selected: string | undefined
  private readonly desired = new Map<string, { key: string; name: string }>()
  private readonly decorations = new Map<
    string,
    { key: string; notification: NativeImage; tray: NativeImage }
  >()
  get selectedCharacter() {
    return this.selected
  }
  set selectedCharacter(value: string | undefined) {
    this.selected = value
    this.updateDecoration()
  }
  prepareCharacter(id: string, profile: Profile) {
    const key = `${profile.revision}/${profile.avatar_revision}/${profile.avatar?.sha256 ?? 'letter'}`
    this.desired.set(id, { key, name: profile.display_name })
    this.updateDecoration()
    return key
  }
  hasDecoration(id: string, key: string) {
    return this.decorations.get(id)?.key === key
  }
  decorate(id: string, key: string, bytes: Uint8Array) {
    if (this.desired.get(id)?.key !== key) return
    const notification = nativeImage
      .createFromBuffer(Buffer.from(bytes))
      .resize({ width: 128, height: 128, quality: 'best' })
    if (notification.isEmpty()) return
    const source = notification.resize({ width: 64, height: 64, quality: 'best' })
    const tray =
      this.platform === 'darwin'
        ? source.resize({ width: 18, height: 18, quality: 'best' })
        : source
    if (this.platform === 'darwin')
      tray.addRepresentation({
        scaleFactor: 2,
        buffer: source.resize({ width: 36, height: 36, quality: 'best' }).toPNG(),
      })
    this.decorations.set(id, { key, notification, tray })
    this.updateDecoration()
  }
  private updateDecoration() {
    if (!this.selected || !this.tray) return
    const decoration = this.decorations.get(this.selected)
    if (decoration || this.fallbackIcon) this.tray.setImage(decoration?.tray ?? this.fallbackIcon!)
    this.tray.setToolTip(this.desired.get(this.selected)?.name ?? 'Yuki')
  }
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
      this.fallbackIcon = icon
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
      this.updateDecoration()
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
      icon:
        this.decorations.get(notice.target.characterId)?.notification ??
        join(app.getAppPath(), 'resources/icons/app/128x128.png'),
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
    this.tray = undefined
    this.notices.forEach((notice) => notice.close())
    this.notices.clear()
    this.decorations.clear()
    this.desired.clear()
  }
}
