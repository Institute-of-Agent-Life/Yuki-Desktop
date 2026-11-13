import type { Chinese } from '../types'

export default {
  intro: '让 Yuki 在聊天平台收发消息。凭据只保存在这个 Yuki 的服务器上，密钥不会再显示。',
  adminOnly: '只有 Yuki 的管理员可以设置聊天平台',
  readOnly:
    '服务器目前无法写入设置目录（webui-config），暂时不能保存。请在服务器上检查这个目录的写入权限。',
  revisionUnavailable:
    '这个 Yuki 的 Client API revision 为 {{revision}}，平台设置需要 {{required}} 以上。请先升级 Yuki。',
  name: {
    telegram: 'Telegram',
    feishu: '飞书',
    lark: 'Lark',
    qq: 'QQ',
  },
  status: {
    disabled: '未启用',
    connected: '已连接',
    connecting: '正在连接',
    failed: '连接错误',
  },
  lastSuccess: '最近成功：{{time}}',
  accounts: '当前账号：{{accounts}}',
  lastError: '最近错误：{{reason}}',
  enable: '启用 {{name}}',
  field: {
    botToken: 'Bot Token',
    appId: 'App ID',
    appSecret: 'App Secret',
    qqAppId: 'AppID',
    qqAppSecret: 'AppSecret',
    sandbox: '沙箱',
    sandboxDescription: '机器人审核上线前只能在沙箱联调，上线后取消。',
  },
  saved: '已保存',
  keepSaved: '留空则保留已保存的值',
  save: '保存',
  removeCredentials: '移除凭据',
  applied: '已保存并应用。',
  savedPendingRestart: '已保存，重启 Yuki 后生效。',
  notApplied: '设置未能应用，请重新读取后再试。',
  conflict: '设置已在其他地方更改，未覆盖。',
  reload: '重新加载',
  pending: '平台设置等待确认',
  pendingDescription: '结果尚未确认，会以原请求查询，不会创建新请求。',
  verify: '重新确认',
  platformCode: '平台错误码：{{code}}',
  preflightFailed: '平台拒绝了新的凭据，原来的连接没有变动。',
  problem: {
    validation_error: '凭据要成对填写；启用前要填好全部字段。',
    operation_unavailable: '服务器目前无法写入设置，尚未保存。',
    capability_denied: '只有 Yuki 的管理员可以设置聊天平台。',
    other: '操作未完成（{{code}}）。',
  },
  errors: {
    telegram_rejected:
      'Telegram 拒绝了这个 Bot Token。请在 BotFather 核对，或用 /revoke 换一个新的。',
    telegram_transport_unknown:
      '服务器连不上 Telegram（api.telegram.org）。请检查服务器的网络或代理设置。',
    telegram_invalid_response: 'Telegram 的响应无法识别，请稍后再试。',
    feishu_rejected:
      '开放平台拒绝了这组 App ID 与 App Secret。请核对应用凭据，并确认应用属于所选的飞书或 Lark。',
    feishu_transport_unknown: '服务器连不上开放平台。请检查服务器的网络或代理设置。',
    feishu_invalid_response: '开放平台的响应无法识别，请稍后再试。',
    feishu_invalid_token_response: '开放平台的响应无法识别，请稍后再试。',
    feishu_invalid_identity: '读不到机器人身份。请确认应用已启用机器人能力并已发布。',
    feishu_websocket_rejected:
      '长连接被拒绝。请在开放平台的事件订阅选择「使用长连接接收事件」，发布应用后再保存一次。',
    feishu_websocket_handshake_failed: '长连接没有建立成功，请检查网络后再保存一次。',
    feishu_reconnect_exhausted: '长连接多次重连失败，已停止。请检查网络后再保存一次。',
    connection_closed: '平台关闭了连接，正在重新连接。',
    qq_official_credentials_rejected:
      'QQ 开放平台拒绝了这组 AppID 与 AppSecret。请核对，并确认服务器的出口 IP 已加入白名单。',
    qq_official_token_unreachable: '服务器连不上 QQ 开放平台。请检查服务器的网络或代理设置。',
    qq_official_transport_unknown: '服务器连不上 QQ 开放平台。请检查服务器的网络或代理设置。',
    qq_official_invalid_token_response: 'QQ 开放平台的响应无法识别，请稍后再试。',
    qq_official_invalid_response: 'QQ 开放平台的响应无法识别，请稍后再试。',
    qq_official_rejected: 'QQ 开放平台拒绝了请求。',
    other: '连接错误（{{category}}）',
  },
  guide: {
    telegram: '获取 Bot Token',
    feishu: '获取飞书应用凭据',
    lark: '获取 Lark 应用凭据',
    qqOfficial: '获取 AppID 与 AppSecret',
  },
  telegramSteps: {
    create: '在 Telegram 打开 @BotFather，发送 /newbot，按提示填写显示名称和以 bot 结尾的用户名。',
    token:
      'BotFather 回复的 token（形如 123456789:AA…）就是这个 Bot 的全部控制权，只粘贴在这里；泄露时在 BotFather 用 /revoke 换一个新的。',
    privacy:
      '要让 Bot 在群里看到普通消息：向 BotFather 发送 /setprivacy，选这个 Bot 再选 Disable，然后把 Bot 移出群再重新拉进来。只私聊不用改。',
    webhook:
      '这个 Bot 设置过 webhook（例如以前接过别的服务）时，Yuki 收不到消息，要先删除：用 getWebhookInfo 检查，url 不为空就调用 deleteWebhook。',
    single: '同一个 token 同一时间只能由一个程序收消息，别的程序也在用时两边会互相挤掉。',
  },
  feishuSteps: {
    create: '在{{console}}创建企业自建应用，启用「机器人」能力。',
    scope: '设置应用的可用范围，让要使用 Yuki 的人能打开机器人，并把机器人加入目标群。',
    events:
      '在「事件与回调」选择「使用长连接接收事件」，订阅 im.message.receive_v1，不需要公网回调地址。',
    permissions:
      '申请权限：单聊 im:message.p2p_msg:readonly、群内 @ im:message.group_at_msg:readonly、群内普通消息 im:message.group_msg、以机器人发送 im:message:send_as_bot、读取消息与资源 im:message:readonly、上传 im:resource。',
    publish: '创建版本并发布，等企业管理员审核通过；之后改权限也要重新发布。',
    credentials:
      '在「凭证与基础信息」复制 App ID 与 App Secret 填到下方。飞书与 Lark 的应用不能混用。',
  },
  feishuConsole: '飞书开放平台（open.feishu.cn）',
  larkConsole: 'Lark 开放平台（open.larksuite.com）',
  qqSteps: {
    register: '用 QQ 登录 QQ 开放平台（q.qq.com），完成开发者注册与认证，创建「QQ 机器人」。',
    credentials:
      '在机器人的开发设置里获取 AppID 与 AppSecret。AppSecret 只在生成时显示，重置后旧的立即失效。',
    whitelist: '开发设置要求 IP 白名单时，加入服务器的出口公网 IP。',
    sandbox: '上线前只能在沙箱联调：把测试用的 QQ 号和群加入沙箱范围，并勾选下方「沙箱」。',
    release: '联调完成后在开放平台提交审核、发布上线，再到这里取消「沙箱」。',
  },
  qqMode: 'QQ 接入方式',
  qqOfficial: '官方 Bot',
  snowluma: 'SnowLuma',
  qqOfficialDescription: '通过 QQ 开放平台的官方机器人接入，不需要登录 QQ 账号，也不需要公网地址。',
  limitsTitle: '官方 Bot 的限制',
  limits: {
    mentions:
      '群里默认只收到 @ 机器人的消息。群主把「机器人可获取的群聊消息范围」改为「获取群内全部消息」后，Yuki 才看得到普通聊天、自然插话。',
    proactive:
      '群里不能主动发消息：每条群消息都要回复群里已收到的一条消息，一条都没收到过的群无法发出。',
    window:
      '回复有时间窗口和次数限制：单聊约 60 分钟、群聊约 5 分钟，超出时这次发送记为失败，不会重试或改发别处。',
    identity: '官方 Bot 给的是 openid，与 SnowLuma 的 QQ 号互不相通，不会自动合并为同一个人。',
  },
  snowlumaDescription:
    'SnowLuma 以一个 QQ 账号登录接入。它的设置在部署目录的 .env，由 Docker Compose 读取，要重建容器才会生效。SnowLuma 上游已停止维护，Yuki 不提供镜像，请填写你自己能拉取的镜像。',
  snowlumaStatus: 'SnowLuma 连接',
  qqLogin: 'QQ 登录',
  qqLoginDescription: '在电脑窗口的 QQ 画面扫码登录。',
  openQQLogin: '打开 QQ 登录',
  qqLoginUnavailable: '服务器没有设置 SNOWLUMA_VNC_HOST，「QQ 登录」暂时不可用。',
  image: 'SnowLuma 镜像',
  imagePlaceholder: 'registry.example.com/you/snowluma:tag',
  enableLocal: '在这台电脑启用',
  enableLocalDescription:
    '写入本机部署的 .env（加入 snowluma、镜像、QQ 画面地址并生成 token 与密码），再重启 Yuki 与 SnowLuma。',
  enabledLocal: 'SnowLuma 已启动。Yuki 重新连上后，就能从「QQ 登录」扫码。',
  serverCommands:
    '这个 Yuki 不在这台电脑上。请在服务器的 Yuki 部署目录（有 .env 与 docker-compose.yml 的目录）执行：',
  copyCommands: '复制命令',
  copied: '已复制。',
  elsewhere:
    'SnowLuma 部署在别处时，不用执行上面的命令：在 Yuki 的 .env 填写 SNOWLUMA_VNC_HOST、SNOWLUMA_VNC_PORT（默认 5900）与 SNOWLUMA_VNC_PASSWORD，让 SnowLuma 的反向 WebSocket 连到 Yuki 的 /onebot/v11/snowluma/ws 并使用同一个 ONEBOT_ACCESS_TOKEN，再重建 Bot。',
} satisfies Chinese<'platforms'>
