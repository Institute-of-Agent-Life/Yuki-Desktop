// App updates.
import type { English } from '../types'

export default {
  // Keyed by `UpdateState['problem']`.
  problem: {
    'no-release': 'No update has been released yet.',
    network: 'Couldn’t check for updates. Try again later.',
    integrity: 'The download or its signature didn’t verify. Check for updates again.',
    download: 'The update didn’t finish downloading. Check again.',
    installation:
      'The update couldn’t be installed; your data and connections are kept. Check again or install it from the download page.',
  },
  unreadable: 'Couldn’t read the update status.',
  actionFailed: 'That didn’t finish. Try again.',
  installFailed: 'The update didn’t start. Try again.',
  restart: 'Restart to Update',
  channel: 'Update Channel',
  channelDescription: 'Stable is for everyday use; Beta brings new features still being tested.',
  stable: 'Stable',
  beta: 'Beta',
  appUpdates: 'App Updates',
  currentVersion: 'Current version {{version}}',
  check: 'Check for Updates',
  development: 'Development Mode',
  developmentDescription: 'Development builds don’t check for or install updates.',
  status: 'Update Status',
  upToDate: 'No updates are available on this channel.',
  available: 'Version {{version}} Available',
  manual: 'For this kind of installation, download the new version and install it yourself.',
  managed: 'Once it’s downloaded, you decide when to restart.',
  releasePage: 'Open Download Page',
  download: 'Download Update',
  downloading: 'Downloading Update',
  progress: 'Update download progress',
  cancelDownload: 'Cancel Download',
  downloaded: '{{version}} Downloaded',
  downloadedDescription:
    'Unsaved changes and control of this computer are checked first, then local activity ends.',
  preparing: 'Preparing Update',
  waiting: 'Waiting for local activity to finish; the app restarts after that.',
  restartSoon: 'The app restarts when it’s ready. Work on the server is kept.',
} satisfies English<'updates'>
