import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { AppUpdater, UpdateCheckResult } from 'electron-updater'
import { AppUpdates, updateMode } from '../../src/main/updates'

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function candidate(version = '1.1.0'): UpdateCheckResult {
  const info = {
    version,
    files: [],
    sha512: 'fixture',
    path: 'fixture.zip',
    releaseDate: '2026-10-20',
  }
  return {
    isUpdateAvailable: true,
    updateInfo: info,
    versionInfo: info,
    cancellationToken: { cancel: vi.fn() } as unknown as NonNullable<
      UpdateCheckResult['cancellationToken']
    >,
  }
}
class SDK extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowDowngrade = true
  allowPrerelease = true
  channel = ''
  requestHeaders: unknown
  logger: unknown
  checkForUpdates = vi.fn(async () => candidate())
  downloadUpdate = vi.fn(async () => {
    this.emit('download-progress', { percent: 25, transferred: 1, total: 4 })
    this.emit('update-downloaded', {
      ...candidate().updateInfo,
      downloadedFile: '/test-only/fixture.zip',
    })
    return [] as string[] // MacUpdater returns [] with autoInstallOnAppQuit=false.
  })
  quitAndInstall = vi.fn()
}
function rig(platform = 'darwin', appImage?: string, packaged = true) {
  const sdk = new SDK(),
    changed = vi.fn()
  const updates = new AppUpdates(
    { version: '1.0.0-beta.1', channel: 'stable', platform, appImage, packaged },
    () => sdk as unknown as AppUpdater,
    changed,
  )
  return { updates, sdk, changed }
}
it('checks explicitly, keeps channels from enabling downgrades and installs only after download readiness', async () => {
  const { updates, sdk, changed } = rig()
  expect(sdk.checkForUpdates).not.toHaveBeenCalled()
  expect(() => updates.installNow()).toThrow('update_not_downloaded')
  expect((await updates.check()).phase).toBe('available')
  expect(sdk).toMatchObject({
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowDowngrade: false,
    allowPrerelease: false,
    channel: 'latest',
    requestHeaders: { 'x-user-staging-id': '' },
  })
  expect(updates.state().releaseUrl).toBe(
    'https://github.com/Institute-of-Agent-Life/Yuki-Desktop/releases/tag/desktop-v1.1.0',
  )
  expect((await updates.download()).phase).toBe('downloaded')
  expect(changed.mock.calls.some(([state]) => state.progress?.percent === 25)).toBe(true)
  expect(sdk.quitAndInstall).not.toHaveBeenCalled()
  updates.prepareInstall()
  expect(updates.state().phase).toBe('preparing')
  expect(sdk.quitAndInstall).not.toHaveBeenCalled()
  updates.installNow()
  expect(sdk.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true)
  expect(updates.state().phase).toBe('installing')
})
it('does not accept a resolved transport without the SDK download completion signal', async () => {
  const { updates, sdk } = rig()
  await updates.check()
  sdk.downloadUpdate.mockImplementationOnce(async () => ['/not-validated'])
  expect((await updates.download()).phase).toBe('error')
  expect(updates.canInstall()).toBe(false)
  expect(sdk.quitAndInstall).not.toHaveBeenCalled()
})
it('keeps checksum failure non-installable and can check/download again', async () => {
  const { updates, sdk } = rig()
  await updates.check()
  sdk.downloadUpdate.mockImplementationOnce(async () => {
    const error = Object.assign(new Error('fixture checksum failure'), {
      code: 'ERR_UPDATER_CHECKSUM_MISMATCH',
    })
    sdk.emit('error', error)
    throw error
  })
  expect(await updates.download()).toMatchObject({ phase: 'error', problem: 'integrity' })
  expect(() => updates.installNow()).toThrow('update_not_downloaded')
  await updates.check()
  expect((await updates.download()).phase).toBe('downloaded')
})
it('retires an old check and serializes a new beta check behind it', async () => {
  const { updates, sdk } = rig()
  const old = deferred<UpdateCheckResult>()
  sdk.checkForUpdates
    .mockImplementationOnce(() => old.promise)
    .mockImplementationOnce(async () => candidate('1.2.0-beta.1'))
  const first = updates.check()
  await vi.waitFor(() => expect(sdk.checkForUpdates).toHaveBeenCalledTimes(1))
  const channel = updates.channel('beta')
  const next = updates.check()
  old.resolve(candidate('1.1.0'))
  await Promise.all([first, channel, next])
  expect(updates.state()).toMatchObject({
    phase: 'available',
    channel: 'beta',
    version: '1.2.0-beta.1',
  })
  expect(sdk.checkForUpdates).toHaveBeenCalledTimes(2)
  expect(sdk.allowPrerelease).toBe(true)
  expect(sdk.allowDowngrade).toBe(false)
})
it('coalesces repeated checks and cancellation cannot turn a late download into a ready installer', async () => {
  const { updates, sdk } = rig()
  const info = candidate(),
    transfer = deferred<string[]>()
  sdk.checkForUpdates.mockResolvedValueOnce(info)
  const a = updates.check(),
    b = updates.check()
  await Promise.all([a, b])
  expect(sdk.checkForUpdates).toHaveBeenCalledTimes(1)
  sdk.downloadUpdate.mockImplementationOnce(() => transfer.promise)
  const download = updates.download()
  await vi.waitFor(() => expect(sdk.downloadUpdate).toHaveBeenCalledTimes(1))
  const cancelled = updates.cancel()
  expect(info.cancellationToken!.cancel).toHaveBeenCalledOnce()
  sdk.emit('update-downloaded', { ...info.updateInfo, downloadedFile: '/late-file' })
  transfer.resolve(['/late-file'])
  await Promise.all([download, cancelled])
  expect(updates.state()).toMatchObject({ phase: 'idle', version: undefined })
  expect(updates.canInstall()).toBe(false)
})
it('reports native installation failure and retains a usable check path', async () => {
  const { updates, sdk } = rig()
  await updates.check()
  await updates.download()
  updates.prepareInstall()
  updates.installNow()
  sdk.emit('error', new Error('native installation rejected'))
  expect(updates.state()).toMatchObject({ phase: 'error', problem: 'installation' })
  expect((await updates.check()).phase).toBe('available')
})
it('keeps the prepared installer fixed while native operations drain and recovers a failed preparation', async () => {
  const { updates, sdk } = rig()
  await updates.check()
  await updates.download()
  updates.prepareInstall()
  expect((await updates.check()).phase).toBe('preparing')
  expect((await updates.cancel()).phase).toBe('preparing')
  await expect(updates.channel('beta')).rejects.toThrow('update_installation_in_progress')
  expect(sdk.checkForUpdates).toHaveBeenCalledTimes(1)
  expect(sdk.quitAndInstall).not.toHaveBeenCalled()
  updates.installFailed()
  expect(updates.state()).toMatchObject({ phase: 'error', problem: 'installation' })
  expect(updates.canInstall()).toBe(false)
  expect((await updates.check()).phase).toBe('available')
})
it.each(['linux', 'darwin', 'win32'])(
  'makes development %s unavailable without contacting the publisher',
  async (platform) => {
    const { updates, sdk } = rig(platform, undefined, false)
    expect((await updates.check()).phase).toBe('unavailable')
    expect(sdk.checkForUpdates).not.toHaveBeenCalled()
  },
)
it('deb/rpm only check feeds and open a manual release route; AppImage uses managed updating', async () => {
  expect(updateMode(true, 'linux')).toBe('manual')
  expect(updateMode(true, 'linux', '/usr/local/Yuki.AppImage')).toBe('managed')
  const { updates, sdk } = rig('linux')
  expect(await updates.check()).toMatchObject({ mode: 'manual', phase: 'available' })
  expect(() => updates.download()).toThrow('update_manual_installation')
  expect(sdk.downloadUpdate).not.toHaveBeenCalled()
  expect(updates.canInstall()).toBe(false)
})
