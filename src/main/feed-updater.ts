import { AppUpdater } from 'electron-updater'
import type { AllPublishOptions } from 'builder-util-runtime'
import type { AppAdapter } from 'electron-updater/out/AppAdapter'
import { ApiError } from './api/client'

/** Feed reader for deb/rpm: never invokes a package manager or downloads an installer. */
export class FeedOnlyUpdater extends AppUpdater {
  constructor(options?: AllPublishOptions | null, app?: AppAdapter) {
    super(options, app)
  }
  protected async doDownloadUpdate(): Promise<string[]> {
    throw new ApiError('update_manual_installation')
  }
  quitAndInstall(): void {
    throw new ApiError('update_manual_installation')
  }
}
