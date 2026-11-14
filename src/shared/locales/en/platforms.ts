import type { English } from '../types'

export default {
  intro:
    'Let Yuki send and receive messages on chat platforms. Credentials are kept only on this Yuki’s server, and secrets are never shown again.',
  adminOnly: 'Only Yuki’s administrators can set up chat platforms',
  readOnly:
    'The server can’t write its settings directory (webui-config) right now, so nothing can be saved. Check that directory’s write permission on the server.',
  revisionUnavailable:
    'This Yuki serves Client API revision {{revision}}; platform settings need {{required}} or later. Update Yuki first.',
  name: {
    telegram: 'Telegram',
    feishu: 'Feishu',
    lark: 'Lark',
    qq: 'QQ',
  },
  status: {
    unset: 'Not set up',
    disabled: 'Off',
    connected: 'Connected',
    connecting: 'Connecting',
  },
  connectedAs: 'Connected as {{accounts}}',
  accountSeparator: ', ',
  qqSummary: '{{mode}} · {{status}}',
  configure: 'Set Up',
  configureName: 'Set Up {{name}}',
  enable: 'Enable {{name}}',
  field: {
    botToken: 'Bot Token',
    appId: 'App ID',
    appSecret: 'App Secret',
    qqAppId: 'AppID',
    qqAppSecret: 'AppSecret',
    sandbox: 'Sandbox',
    sandboxDescription: 'Until review and release, the bot works only in its sandbox.',
  },
  saved: 'Saved',
  save: 'Save',
  cancel: 'Cancel',
  done: 'Done',
  removeCredentials: 'Remove Credentials',
  applied: 'Saved and applied.',
  savedPendingRestart: 'Saved. It takes effect after Yuki restarts.',
  notApplied: 'The settings weren’t applied. Reload and try again.',
  conflict: 'These settings were changed elsewhere and weren’t overwritten.',
  reload: 'Reload',
  pending: 'Platform settings awaiting confirmation',
  pendingDescription:
    'The result isn’t confirmed yet. Checking asks about the original request and doesn’t send a new one.',
  verify: 'Check Again',
  platformCode: 'Platform error code: {{code}}',
  preflightFailed:
    'The platform refused the new credentials. The existing connection is unchanged.',
  problem: {
    validation_error: 'Credentials go in pairs, and every field must be filled in before enabling.',
    operation_unavailable: 'The server can’t write its settings right now. Nothing was saved.',
    capability_denied: 'Only Yuki’s administrators can set up chat platforms.',
    other: 'The operation didn’t finish ({{code}}).',
  },
  errors: {
    telegram_rejected:
      'Telegram refused this Bot Token. Check it with BotFather, or get a new one with /revoke.',
    telegram_transport_unknown:
      'The server can’t reach Telegram (api.telegram.org). Check the server’s network or proxy settings.',
    telegram_invalid_response: 'Telegram’s response couldn’t be read. Try again later.',
    feishu_rejected:
      'The open platform refused this App ID and App Secret. Check the app credentials and that the app belongs to the platform you chose (Feishu or Lark).',
    feishu_transport_unknown:
      'The server can’t reach the open platform. Check the server’s network or proxy settings.',
    feishu_invalid_response: 'The open platform’s response couldn’t be read. Try again later.',
    feishu_invalid_token_response:
      'The open platform’s response couldn’t be read. Try again later.',
    feishu_invalid_identity:
      'The bot’s identity couldn’t be read. Make sure the app has the bot capability and is published.',
    feishu_websocket_rejected:
      'The long connection was refused. In the open platform’s event subscription, choose to receive events through a long connection, publish the app, then save again.',
    feishu_websocket_handshake_failed:
      'The long connection couldn’t be established. Check the network, then save again.',
    feishu_reconnect_exhausted:
      'The long connection failed repeatedly and stopped. Check the network, then save again.',
    connection_closed: 'The platform closed the connection. Reconnecting.',
    qq_official_credentials_rejected:
      'The QQ open platform refused this AppID and AppSecret. Check them, and that the server’s public IP is on the allowlist.',
    qq_official_token_unreachable:
      'The server can’t reach the QQ open platform. Check the server’s network or proxy settings.',
    qq_official_transport_unknown:
      'The server can’t reach the QQ open platform. Check the server’s network or proxy settings.',
    qq_official_invalid_token_response:
      'The QQ open platform’s response couldn’t be read. Try again later.',
    qq_official_invalid_response:
      'The QQ open platform’s response couldn’t be read. Try again later.',
    qq_official_rejected: 'The QQ open platform refused the request.',
    other: 'Connection error ({{category}})',
  },
  howTo: 'How to Get Them',
  console: {
    telegram: 'Open BotFather',
    feishu: 'Open Feishu Open Platform',
    lark: 'Open Lark Developer',
    qq_official: 'Open QQ Open Platform',
  },
  telegramSteps: {
    create: 'In Telegram, send /newbot to @BotFather and follow the prompts.',
    token:
      'Enter the token it replies with as the Bot Token; if it leaks, get a new one with /revoke.',
    privacy:
      'To see ordinary group messages, send /setprivacy to BotFather, choose Disable, then add the bot to the group again.',
    webhook:
      'Only one program at a time can receive with a token; if the bot ever had a webhook, call deleteWebhook first.',
  },
  feishuSteps: {
    create:
      'In the {{console}}, create a custom enterprise app, enable its Bot capability, and add the people who use Yuki to its availability.',
    events:
      'Under Events & Callbacks, choose to receive events through a long connection and subscribe to im.message.receive_v1.',
    permissions:
      'Request im:message.p2p_msg:readonly, im:message.group_at_msg:readonly, im:message.group_msg, im:message:send_as_bot, im:message:readonly and im:resource.',
    publish:
      'Create and publish a version and wait for approval; permission changes need a new release too.',
    credentials:
      'Copy the App ID and App Secret from Credentials & Basic Info; Feishu and Lark apps aren’t interchangeable.',
  },
  feishuConsole: 'Feishu Open Platform',
  larkConsole: 'Lark Developer console',
  qqSteps: {
    register: 'Register as a developer on the QQ open platform (q.qq.com) and create a QQ bot.',
    credentials:
      'Find the AppID and AppSecret in its development settings; if an IP allowlist is required, add the server’s public IP.',
    sandbox:
      'Before release, add the QQ accounts and groups you test with to the sandbox and turn on Sandbox.',
    release: 'Once it’s reviewed and released, come back and turn off Sandbox.',
  },
  qqMode: 'QQ Connection',
  qqOfficial: 'Official Bot',
  snowluma: 'SnowLuma',
  limitsTitle: 'Limits of the Official Bot',
  limits: {
    mentions:
      'In groups, only messages that @mention the bot arrive until the group owner allows it to read all messages.',
    replies:
      'It can’t start a group message and can only reply within a time window (about 60 minutes in private chats, 5 minutes in groups).',
    identity:
      'Its openids are separate from SnowLuma’s QQ numbers and are never merged into one person.',
  },
  snowlumaDescription:
    'SnowLuma connects by signing in to a QQ account. Its settings live in the deployment’s .env and take effect when the containers are recreated.',
  snowlumaStatus: 'Status',
  qqLogin: 'QQ Sign-In',
  qqLoginDescription: 'Scan the code on the QQ screen in the computer window.',
  openQQLogin: 'Open QQ Sign-In',
  qqLoginUnavailable: 'The server has no SNOWLUMA_VNC_HOST set, so QQ Sign-In isn’t available.',
  image: 'SnowLuma Image',
  imageDescription:
    'SnowLuma is no longer maintained upstream and Yuki ships no image; enter one you can pull yourself.',
  imagePlaceholder: 'registry.example.com/you/snowluma:tag',
  enableLocal: 'Enable on This Computer',
  enableLocalDescription:
    'Writes the local deployment’s .env (adds snowluma, the image and the QQ screen address, and generates a token and password), then restarts Yuki with SnowLuma.',
  enabledLocal: 'SnowLuma is running. Once Yuki reconnects, scan the code in QQ Sign-In.',
  enableServer: 'Enable on the Server',
  enableServerDescription:
    'Uses the SSH sign-in saved on this computer to run sh deploy/snowluma.sh in the server’s deployment directory, then restarts Yuki with SnowLuma.',
  enabledServer:
    'SnowLuma is running on the server. Once Yuki reconnects, scan the code in QQ Sign-In.',
  serverCommands:
    'This Yuki isn’t on this computer. Run the following in the Yuki deployment directory on the server (the one with .env):',
  copyCommands: 'Copy Commands',
  copied: 'Copied.',
  elsewhereTitle: 'SnowLuma Runs Elsewhere',
  elsewhere:
    'Skip the commands above: set SNOWLUMA_VNC_HOST, SNOWLUMA_VNC_PORT (default 5900) and SNOWLUMA_VNC_PASSWORD in Yuki’s .env, point SnowLuma’s reverse WebSocket at Yuki’s /onebot/v11/snowluma/ws with the same ONEBOT_ACCESS_TOKEN, then recreate the Bot.',
} satisfies English<'platforms'>
