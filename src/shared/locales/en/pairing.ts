// Connecting to a Yuki: pairing and the Tailscale guide.
import type { English } from '../types'

export default {
  connectExisting: 'Connect Your Yuki',
  deployLocal: 'Set Up Yuki on This Computer',
  skip: 'Look Around First',
  settings: 'Settings',
  help: 'Help',
  welcomeDescription: 'Talk with her and get things done together. Choose where to start.',
  confirmDescription: 'Check the Yuki and its server, then let this device connect.',
  connectDescription: 'Paste a pairing link or the full pairing details you received.',
  noServer:
    'These pairing details have no server address. Ask whoever sent them for it, or connect manually.',
  viewUpdate: 'View App Update',
  resumeLogout: 'Finish Signing Out of the Old Connection',
  reconnect: 'Reconnecting your original entry. Drafts and unconfirmed requests are kept.',
  pendingCredentials:
    'This device’s credentials for {{name}} were received, but your details are still unconfirmed. You can continue without redeeming the link code again.',
  resume: 'Continue Connecting {{name}}',
  forgetPending: 'Discard Unfinished Connection',
  notPersistent:
    'System credential storage is off, so this can only continue while the app keeps running.',
  server: 'Server: {{server}}',
  reachability:
    'Use a Yuki address this computer can reach. If the server has no public address, choose “Connect over SSH”; no separate tunnel is needed. With a VPN or Tailscale, join that network first.',
  codeLabel: 'Pairing link, link code, or full reply',
  codeHint:
    'Get pairing details from a Yuki you’re already connected to; a link code works only once. Without a link, you can enter the address manually.',
  enterServer: 'Enter Server Address',
  serverAddress: 'Server address',
  deviceName: 'Name of this device',
  confirmConnect: 'Confirm and Connect',
  tailscale: {
    label: 'Connecting with Tailscale',
    summary: 'Connect with Tailscale',
    intro:
      'Once this computer and the server running Yuki are on the same Tailscale network, you can use the server’s HTTPS address.',
    computerTitle: 'Prepare this computer',
    computer:
      'Install the official Tailscale app, open it, sign in, and join the server’s network.',
    download: 'Download Tailscale',
    serverTitle: 'On the server running Yuki',
    server:
      'Ask whoever deployed Yuki to install Tailscale, sign in, and publish Yuki following the guide. Check the actual ports first and keep any publishing the server already has.',
    guide: 'Server Setup Guide',
    commandIntro:
      'Here is a command template for the server. Replace both ports first, then run it on the server running Yuki.',
    command: 'sudo tailscale serve --bg --https=<HTTPS port> http://127.0.0.1:<Yuki host port>',
    copyCommand: 'Copy Command Template',
    connectTitle: 'Connect with the usual fields',
    connect:
      'Enter the actual HTTPS address or paste the original pairing link, then confirm the Yuki as usual. For an existing connection, choose “Change…” under Connection Method in Settings.',
    skip: 'If you already have a working server address or pairing link, just continue; you don’t need to finish this guide first.',
  },
} satisfies English<'pairing'>
