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
    disabled: 'Off',
    connected: 'Connected',
    connecting: 'Connecting',
    failed: 'Connection error',
  },
  lastSuccess: 'Last success: {{time}}',
  accounts: 'Account: {{accounts}}',
  lastError: 'Last error: {{reason}}',
  enable: 'Enable {{name}}',
  field: {
    botToken: 'Bot Token',
    appId: 'App ID',
    appSecret: 'App Secret',
    qqAppId: 'AppID',
    qqAppSecret: 'AppSecret',
    sandbox: 'Sandbox',
    sandboxDescription:
      'Before review and release, the bot works only in its sandbox. Turn this off once it’s live.',
  },
  saved: 'Saved',
  keepSaved: 'Leave empty to keep the saved value',
  save: 'Save',
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
  guide: {
    telegram: 'Getting a Bot Token',
    feishu: 'Getting Feishu App Credentials',
    lark: 'Getting Lark App Credentials',
    qqOfficial: 'Getting the AppID and AppSecret',
  },
  telegramSteps: {
    create:
      'In Telegram, open @BotFather, send /newbot, and follow the prompts for a display name and a username ending in “bot”.',
    token:
      'The token BotFather replies with (like 123456789:AA…) is full control of this bot. Paste it only here; if it leaks, get a new one with /revoke in BotFather.',
    privacy:
      'For the bot to see ordinary group messages: send /setprivacy to BotFather, pick this bot, choose Disable, then remove the bot from the group and add it back. Not needed for private chats.',
    webhook:
      'If this bot ever had a webhook (for example, another service used it), Yuki receives nothing until it’s deleted: check with getWebhookInfo, and if the url isn’t empty, call deleteWebhook.',
    single:
      'Only one program at a time can receive messages with a token; two programs using it push each other off.',
  },
  feishuSteps: {
    create: 'In the {{console}}, create a custom enterprise app and enable its Bot capability.',
    scope:
      'Set the app’s availability so the people using Yuki can open the bot, and add the bot to the target groups.',
    events:
      'Under Events & Callbacks, choose to receive events through a long connection and subscribe to im.message.receive_v1. No public callback address is needed.',
    permissions:
      'Request permissions: direct messages im:message.p2p_msg:readonly, group mentions im:message.group_at_msg:readonly, ordinary group messages im:message.group_msg, sending as the bot im:message:send_as_bot, reading messages and resources im:message:readonly, uploads im:resource.',
    publish:
      'Create and publish a version, and wait for your organization’s administrator to approve it. Permission changes need a new release too.',
    credentials:
      'Copy the App ID and App Secret from Credentials & Basic Info into the fields below. Feishu and Lark apps aren’t interchangeable.',
  },
  feishuConsole: 'Feishu Open Platform (open.feishu.cn)',
  larkConsole: 'Lark Developer console (open.larksuite.com)',
  qqSteps: {
    register:
      'Sign in to the QQ open platform (q.qq.com) with QQ, complete developer registration and verification, and create a QQ bot.',
    credentials:
      'Find the AppID and AppSecret in the bot’s development settings. The AppSecret is shown only when generated; resetting it invalidates the old one at once.',
    whitelist:
      'If the development settings ask for an IP allowlist, add the server’s public outbound IP.',
    sandbox:
      'Until it’s released, the bot works only in its sandbox: add the QQ accounts and groups you test with to the sandbox, and turn on Sandbox below.',
    release:
      'When testing is done, submit the bot for review and release it on the open platform, then turn off Sandbox here.',
  },
  qqMode: 'QQ Connection',
  qqOfficial: 'Official Bot',
  snowluma: 'SnowLuma',
  qqOfficialDescription:
    'Connects through an official bot on the QQ open platform. No QQ account sign-in and no public address needed.',
  limitsTitle: 'Limits of the Official Bot',
  limits: {
    mentions:
      'In groups, only messages that @mention the bot arrive by default. Yuki sees ordinary chat and joins in naturally only after the group owner sets the bot’s group message range to all messages.',
    proactive:
      'The bot can’t start a group message: every group message must reply to one the group already sent, so a group that has sent nothing can’t be reached.',
    window:
      'Replies have a time window and a count limit: about 60 minutes in private chats and 5 minutes in groups. Past that, the send is recorded as failed and isn’t retried or sent elsewhere.',
    identity:
      'The official bot identifies people by openid, separate from SnowLuma’s QQ numbers; the two are never merged into one person automatically.',
  },
  snowlumaDescription:
    'SnowLuma connects by signing in to a QQ account. Its settings live in the deployment’s .env, read by Docker Compose, and take effect when the containers are recreated. SnowLuma is no longer maintained upstream and Yuki ships no image; enter an image you can pull yourself.',
  snowlumaStatus: 'SnowLuma Connection',
  qqLogin: 'QQ Sign-In',
  qqLoginDescription: 'Scan the code on the QQ screen in the computer window.',
  openQQLogin: 'Open QQ Sign-In',
  qqLoginUnavailable: 'The server has no SNOWLUMA_VNC_HOST set, so QQ Sign-In isn’t available.',
  image: 'SnowLuma Image',
  imagePlaceholder: 'registry.example.com/you/snowluma:tag',
  enableLocal: 'Enable on This Computer',
  enableLocalDescription:
    'Writes the local deployment’s .env (adds snowluma, the image and the QQ screen address, and generates a token and password), then restarts Yuki with SnowLuma.',
  enabledLocal: 'SnowLuma is running. Once Yuki reconnects, scan the code in QQ Sign-In.',
  serverCommands:
    'This Yuki isn’t on this computer. Run the following in the Yuki deployment directory on the server (the one with .env and docker-compose.yml):',
  copyCommands: 'Copy Commands',
  copied: 'Copied.',
  elsewhere:
    'If SnowLuma runs somewhere else, skip the commands above: set SNOWLUMA_VNC_HOST, SNOWLUMA_VNC_PORT (default 5900) and SNOWLUMA_VNC_PASSWORD in Yuki’s .env, point SnowLuma’s reverse WebSocket at Yuki’s /onebot/v11/snowluma/ws with the same ONEBOT_ACCESS_TOKEN, then recreate the Bot.',
} satisfies English<'platforms'>
