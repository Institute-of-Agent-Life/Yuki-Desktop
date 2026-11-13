// Settings → Connection: the server, proactive messages, data and logout.
import type { English } from '../types'

export default {
  server: 'Server',
  status: 'Status',
  checking: 'Checking…',
  unreachable: 'Can’t connect',
  connected: 'Connected',
  recheck: 'Check Again',
  proactive: 'Proactive Messages',
  routeUnavailable:
    'This entry has no connection that can receive messages right now. Choose another entry.',
  routeAmbiguous:
    'This entry has more than one receiving connection. Confirm the destination on the server first.',
  routeUpdated: 'Proactive message destination updated.',
  proactiveTo: 'Where {{name}} Reaches You',
  paused: 'Paused for now; choose an available entry to resume.',
  updating: 'Updating…',
  entryLabel: 'Entry for proactive messages',
  chooseEntry: 'Choose an Entry',
  ownEntry: 'Your Entry',
  entry: '{{platform}} · {{name}}',
  entryThisApp: '{{platform}} · {{name}} (this app)',
  routePending: 'Proactive route change: result not confirmed yet.',
  data: 'Profile',
  about: "{{name}}'s Name, Avatar & Personality",
  technical: 'Technical Details',
  serverVersion: 'Server Version',
  apiVersion: 'API Version',
  pending: {
    description:
      'The result isn’t confirmed yet. Checking uses the original request and doesn’t create a new one.',
    verify: 'Check Again',
  },
  logout: {
    title: 'Log Out',
    named: 'Log Out of {{name}}',
    credentialExpired:
      'This device’s credential is no longer valid. Choose what happens to local data.',
    description: 'Revoke this device’s sign-in, then keep or delete local data.',
    resume: 'Continue Logout',
    start: 'Log Out…',
    notConfirmed: 'Logout isn’t confirmed yet. Local content is still kept.',
    cleanupFailed: 'Local data hasn’t been handled yet. Try again.',
    confirmTitle: 'Log Out of This Yuki?',
    revokeAndContinue: 'Revoke and Continue',
    confirmBody:
      'This device’s credential for “{{name}}” is revoked first; then you choose whether to keep or delete local content.',
    finishing: 'Finishing operations in progress and confirming the device credential…',
    localTitle: 'Local Content',
    deleteLocal: 'Delete Local Data…',
    keepAndLogout: 'Keep and Log Out',
    localIntro: 'This device’s credential is no longer valid. On this computer, your entry has:',
    drafts_one: '{{count}} draft',
    drafts_other: '{{count}} drafts',
    pending_one: '{{count}} request awaiting confirmation',
    pending_other: '{{count}} requests awaiting confirmation',
    attachments_one: '{{count}} attachment waiting to send',
    attachments_other: '{{count}} attachments waiting to send',
    keepNote:
      'If you keep it, you can continue checking it after you pair again. Other people won’t get this content.',
    resumeDeleteTitle: 'Continue Deleting Local Data',
    deleteTitle: 'Delete Local Data?',
    later: 'Later',
    retryDelete: 'Retry Delete and Log Out',
    deleteAndLogout: 'Delete and Log Out',
    deleteBody:
      'Removes your entry’s drafts, pending content, attachment snapshots and read cache from this computer. This can’t be undone. Data already delivered to the server and files saved elsewhere are kept.',
  },
} satisfies English<'connection'>
