import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LoginItem, desktopExec } from '../../src/main/login-item'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'yuki-login-'))
  roots.push(path)
  return path
}
it('Linux writes only its user override and disabling does not expose the system autostart again', async () => {
  const path = await root(),
    user = join(path, 'user'),
    system = join(path, 'system')
  await mkdir(join(system, 'autostart'), { recursive: true })
  const original = '[Desktop Entry]\nType=Application\nName=Yuki\nExec="/opt/Yuki/Yuki"\n'
  await writeFile(join(system, 'autostart', 'life.yuki.desktop.desktop'), original)
  const native = new LoginItem({
    platform: 'linux',
    packaged: true,
    configHome: user,
    systemConfigDirectories: [system],
    executable: '/home/person/項目實戰/Yuki.AppImage',
    get: () => {
      throw Error('must not call Windows/macOS APIs')
    },
    set: () => {
      throw Error('unexpected native call')
    },
  })
  expect((await native.read()).enabled).toBe(true)
  await native.set(false)
  expect((await native.read()).enabled).toBe(false)
  expect(await readFile(join(system, 'autostart', 'life.yuki.desktop.desktop'), 'utf8')).toBe(
    original,
  )
  await writeFile(join(user, 'autostart', 'other.desktop'), 'keep this other application')
  expect((await native.set(true)).enabled).toBe(true)
  expect(await readFile(join(user, 'autostart', 'life.yuki.desktop.desktop'), 'utf8')).toContain(
    'Exec="/home/person/項目實戰/Yuki.AppImage"',
  )
  expect(await readFile(join(user, 'autostart', 'other.desktop'), 'utf8')).toBe(
    'keep this other application',
  )
  expect((await readdir(join(user, 'autostart'))).sort()).toEqual([
    'life.yuki.desktop.desktop',
    'other.desktop',
  ])
})
it.each(['darwin', 'win32'] as const)(
  '%s reports actual OS approval instead of optimistically showing enabled',
  async (platform) => {
    let requested = false,
      approved = false
    const set = vi.fn((value: boolean) => {
      requested = value
    })
    const native = new LoginItem({
      platform,
      packaged: true,
      configHome: 'unused',
      executable: 'unused',
      set,
      get: () => ({
        openAtLogin: requested,
        status: requested && !approved ? 'requires-approval' : 'enabled',
        executableWillLaunchAtLogin: requested && approved,
      }),
    })
    expect(await native.set(true)).toMatchObject({
      enabled: false,
      available: true,
      reason: 'system-approval-required',
    })
    expect(set).toHaveBeenCalledWith(true)
    approved = true
    expect(await native.read()).toMatchObject({ enabled: true, reason: null })
    expect(await native.set(false)).toMatchObject({ enabled: false, reason: null })
  },
)
it('development binaries do not register the generic Electron executable at login', async () => {
  const set = vi.fn(),
    native = new LoginItem({
      platform: 'darwin',
      packaged: false,
      configHome: 'unused',
      executable: 'Electron',
      get: () => ({ openAtLogin: false }),
      set,
    })
  expect(await native.read()).toMatchObject({ available: false, reason: 'install-required' })
  await expect(native.set(true)).rejects.toHaveProperty('code', 'precondition_failed')
  expect(set).not.toHaveBeenCalled()
})
it('Desktop Entry output quotes spaces and preserves shell metacharacters as literal arguments', () => {
  expect(desktopExec('/a path/Yuki')).toBe('"/a path/Yuki"')
  expect(desktopExec('/a%20/$name')).toBe('"/a%%20/\\\\$name"')
  expect(desktopExec('/a\\b/"x"')).toBe('"/a\\\\\\\\b/\\\\"x\\\\""')
})
