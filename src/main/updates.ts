import type { AppUpdater, UpdateCheckResult } from 'electron-updater'
import { ApiError } from './api/client'
import { DESKTOP_RELEASES, type UpdateChannel, type UpdateState } from '../shared/updates'

export function updateMode(
  packaged: boolean,
  platform: string,
  appImage?: string,
): UpdateState['mode'] {
  return !packaged ? 'development' : platform === 'linux' && !appImage ? 'manual' : 'managed'
}
function problem(error: unknown, download = false): UpdateState['problem'] {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (/CHECKSUM|SIGNATURE|SIGNATURE_VERIFY|DIFFERENTIAL|INVALID_DIGEST/.test(code))
    return 'integrity'
  if (/LATEST_VERSION_NOT_FOUND|CHANNEL_FILE_NOT_FOUND|NO_PUBLISHED_VERSIONS/.test(code))
    return 'no-release'
  return download ? 'download' : 'network'
}
/** One SDK transport at a time; retired checks/downloads cannot change the selected channel. */
export class AppUpdates {
  private value: UpdateState
  private sdk?: AppUpdater
  private candidate?: UpdateCheckResult
  private pending?: Promise<UpdateState>
  private pendingEpoch = 0
  private epoch = 0
  constructor(
    readonly options: {
      version: string
      packaged: boolean
      platform: string
      appImage?: string
      channel: UpdateChannel
    },
    private factory: () => AppUpdater,
    private changed: (state: UpdateState) => void,
  ) {
    this.value = {
      phase: options.packaged ? 'idle' : 'unavailable',
      mode: updateMode(options.packaged, options.platform, options.appImage),
      channel: options.channel,
      currentVersion: options.version,
      releaseUrl: DESKTOP_RELEASES,
    }
  }
  state(): UpdateState {
    return structuredClone(this.value)
  }
  private publish(patch: Partial<UpdateState>) {
    this.value = { ...this.value, ...patch }
    this.changed(this.state())
  }
  private engine() {
    if (!this.sdk) {
      const sdk = this.factory()
      sdk.autoDownload = false
      sdk.autoInstallOnAppQuit = false
      sdk.logger = null
      // Do not transmit the SDK's generated persistent staging identifier.
      sdk.requestHeaders = { 'x-user-staging-id': '' }
      // SDK errors also reject the operation promise; consume the emitter's error event.
      sdk.on('error', () => {
        if (this.value.phase === 'installing')
          this.publish({ phase: 'error', problem: 'installation' })
      })
      this.sdk = sdk
    }
    this.sdk.channel = this.value.channel === 'stable' ? 'latest' : 'beta'
    this.sdk.allowDowngrade = false // Setting channel otherwise enables downgrades in the SDK.
    this.sdk.allowPrerelease = this.value.channel === 'beta'
    return this.sdk
  }
  private run(
    download: boolean,
    operation: (epoch: number) => Promise<void>,
  ): Promise<UpdateState> {
    if (this.pending) {
      if (this.pendingEpoch === this.epoch) return this.pending
      return this.pending.then(() => this.run(download, operation))
    }
    const epoch = this.epoch
    const work = Promise.resolve()
      .then(() => operation(epoch))
      .catch((error) => {
        if (epoch === this.epoch)
          this.publish({ phase: 'error', problem: problem(error, download), progress: undefined })
      })
      .then(() => this.state())
    this.pendingEpoch = epoch
    this.pending = work
    void work.then(() => {
      if (this.pending === work) this.pending = undefined
    })
    return work
  }
  check(): Promise<UpdateState> {
    if (['preparing', 'installing'].includes(this.value.phase)) return Promise.resolve(this.state())
    if (this.value.mode === 'development') return Promise.resolve(this.state())
    return this.run(false, async (epoch) => {
      this.candidate = undefined
      this.publish({
        phase: 'checking',
        problem: undefined,
        progress: undefined,
        version: undefined,
        releaseUrl: DESKTOP_RELEASES,
      })
      const result = await this.engine().checkForUpdates()
      if (epoch !== this.epoch) return
      if (!result) {
        this.publish({ phase: 'unavailable' })
        return
      }
      this.candidate = result.isUpdateAvailable ? result : undefined
      this.publish({
        phase: result.isUpdateAvailable ? 'available' : 'current',
        version: result.isUpdateAvailable ? result.updateInfo.version : undefined,
        releaseUrl: result.isUpdateAvailable
          ? `${DESKTOP_RELEASES}/tag/${encodeURIComponent('desktop-v' + result.updateInfo.version)}`
          : DESKTOP_RELEASES,
      })
    })
  }
  download(): Promise<UpdateState> {
    if (this.value.mode !== 'managed') throw new ApiError('update_manual_installation')
    if (this.value.phase === 'downloading' && this.pending) return this.pending
    if (this.value.phase !== 'available' || !this.candidate)
      throw new ApiError('update_not_available')
    return this.run(true, async (epoch) => {
      const sdk = this.engine()
      let downloaded = false
      const ready = () => {
        downloaded = true
      }
      const progress = (info: { percent: number; transferred: number; total: number }) => {
        if (epoch === this.epoch)
          this.publish({
            progress: { percent: info.percent, transferred: info.transferred, total: info.total },
          })
      }
      sdk.on('download-progress', progress)
      sdk.on('update-downloaded', ready)
      this.publish({
        phase: 'downloading',
        problem: undefined,
        progress: { percent: 0, transferred: 0, total: 0 },
      })
      try {
        await sdk.downloadUpdate(this.candidate!.cancellationToken)
        if (epoch !== this.epoch) return
        if (!downloaded) throw new ApiError('update_download_failed')
        this.publish({ phase: 'downloaded', progress: undefined })
      } finally {
        sdk.removeListener('download-progress', progress)
        sdk.removeListener('update-downloaded', ready)
      }
    })
  }
  async cancel(): Promise<UpdateState> {
    if (['preparing', 'installing'].includes(this.value.phase)) return this.state()
    this.epoch++
    this.candidate?.cancellationToken?.cancel()
    await this.pending
    this.candidate = undefined
    this.publish({
      phase: this.value.mode === 'development' ? 'unavailable' : 'idle',
      problem: undefined,
      version: undefined,
      progress: undefined,
      releaseUrl: DESKTOP_RELEASES,
    })
    return this.state()
  }
  async channel(channel: UpdateChannel): Promise<UpdateState> {
    if (['preparing', 'installing'].includes(this.value.phase))
      throw new ApiError('update_installation_in_progress')
    if (channel === this.value.channel) return this.state()
    this.value.channel = channel
    await this.cancel()
    return this.state()
  }
  canInstall() {
    return this.value.mode === 'managed' && this.value.phase === 'downloaded'
  }
  installFailed() {
    if (['preparing', 'installing'].includes(this.value.phase))
      this.publish({ phase: 'error', problem: 'installation' })
  }
  prepareInstall() {
    if (!this.canInstall()) throw new ApiError('update_not_downloaded')
    this.publish({ phase: 'preparing' })
  }
  installNow() {
    if (!(this.canInstall() || this.value.phase === 'preparing'))
      throw new ApiError('update_not_downloaded')
    this.publish({ phase: 'installing' })
    // Caller has already finished renderer navigation, control handback and native-effect drain.
    try {
      this.engine().quitAndInstall(false, true)
    } catch {
      this.publish({ phase: 'error', problem: 'installation' })
    }
  }
}
