import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LoginItemState } from '../shared/desktop'
import { ApiError } from './api/client'

interface Host {
  platform: 'darwin' | 'win32' | 'linux'
  packaged: boolean
  executable: string
  configHome: string
  systemConfigDirectories?: readonly string[]
  get(): { openAtLogin: boolean; executableWillLaunchAtLogin?: boolean; status?: string }
  set(enabled: boolean): void
}

// Desktop Entry quoting has both string-value and Exec argument escaping.
// https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html
export function desktopExec(path: string) {
  const quoted = path.replace(/%/g, '%%').replace(/[\\"$`]/g, (char) => `\\${char}`)
  return `"${quoted.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`
}

export class LoginItem {
  constructor(readonly host: Host) {}
  private get path() {
    return join(this.host.configHome, 'autostart', 'life.yuki.desktop.desktop')
  }
  async read(): Promise<LoginItemState> {
    if (!this.host.packaged) return { enabled: false, available: false, reason: 'install-required' }
    if (this.host.platform === 'linux') {
      for (const path of [
        this.path,
        ...(this.host.systemConfigDirectories ?? []).map((root) =>
          join(root, 'autostart', 'life.yuki.desktop.desktop'),
        ),
      ]) {
        let value: string
        try {
          value = await readFile(path, 'utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw error
        }
        return {
          enabled:
            /^Type\s*=\s*Application\s*$/m.test(value) &&
            /^Exec\s*=\s*\S.+$/m.test(value) &&
            !/^Hidden\s*=\s*true\s*$/m.test(value),
          available: true,
          reason: null,
        }
      }
      return { enabled: false, available: true, reason: null }
    }
    const value = this.host.get()
    const approval =
      value.status === 'requires-approval' ||
      (this.host.platform === 'win32' &&
        value.openAtLogin &&
        value.executableWillLaunchAtLogin === false)
    return {
      enabled: value.openAtLogin && !approval,
      available: true,
      reason: approval ? 'system-approval-required' : null,
    }
  }
  async set(enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new ApiError('validation_error')
    if (!this.host.packaged) throw new ApiError('precondition_failed')
    if (this.host.platform === 'linux') {
      const directory = join(this.host.configHome, 'autostart')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const temporary = join(directory, `.yuki-${randomUUID()}.desktop`)
      const value = `[Desktop Entry]\nType=Application\nName=Yuki\nExec=${desktopExec(this.host.executable)}\nTerminal=false\nHidden=${!enabled}\n`
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(value, 'utf8')
        await handle.close()
        await rename(temporary, this.path)
      } finally {
        await handle.close()
        await unlink(temporary).catch((error) => {
          if (error.code !== 'ENOENT') throw error
        })
      }
    } else this.host.set(enabled)
    return this.read()
  }
}
