import type { Chinese } from '../types'

// Connecting to a Yuki: pairing and the Tailscale guide.
export default {
  connectExisting: '连接已有 Yuki',
  deployLocal: '在本机部署 Yuki',
  skip: '先逛逛，稍后设置',
  settings: '设置',
  help: '使用说明',
  welcomeDescription: '和她聊聊，一起把事情做好。选择你想从哪里开始。',
  confirmDescription: '确认 Yuki 与服务器，再允许这台设备连接。',
  connectDescription: '粘贴配对链接或收到的完整配对信息。',
  noServer: '这份配对信息没有服务器地址，请向提供者获取，或选择手动连接。',
  viewUpdate: '查看 App 更新',
  resumeLogout: '处理原连接的退出登录数据',
  reconnect: '重新连接原本人入口；草稿与未确认请求仍保留。',
  pendingCredentials:
    '已领取 {{name}} 的设备凭据，尚待确认本人数据。可以继续，不必重新兑换配对码。',
  resume: '继续连接 {{name}}',
  forgetPending: '放弃本机待完成连接',
  notPersistent: '未启用系统凭据保存，仅能在这次 App 运行中继续。',
  server: '服务器：{{server}}',
  reachability:
    '使用可从这台电脑访问的 Yuki 网址。服务器没有公开网址时，选“通过 SSH 连接”，不必另外建立通道；使用 VPN 或 Tailscale 时，请先连上该网络。',
  codeLabel: '配对链接、绑定码或完整回复',
  codeHint: '从已连接的 Yuki 获取配对信息；绑定码只可使用一次。没有链接时可手动输入地址。',
  enterServer: '手动输入服务器地址',
  serverAddress: '服务器地址',
  deviceName: '这台设备的名称',
  confirmConnect: '确认并连接',
  tailscale: {
    label: 'Tailscale 连接说明',
    summary: '通过 Tailscale 连接',
    intro:
      '这台电脑和运行 Yuki 的服务器加入可互通的 Tailscale 网络后，就能使用服务器的 HTTPS 网址。',
    computerTitle: '准备这台电脑',
    computer: '安装官方 Tailscale，打开并登录，加入服务器所在的网络。',
    download: '下载 Tailscale',
    serverTitle: '在运行 Yuki 的服务器上操作',
    server: '请部署者按指南安装、登录并发布 Yuki。先确认实际端口，保留服务器已有的发布设置。',
    guide: '服务器接入指南',
    commandIntro: '以下是服务器命令模板，请部署者先替换两个端口，再到运行 Yuki 的服务器上操作。',
    command: 'sudo tailscale serve --bg --https=<HTTPS端口> http://127.0.0.1:<Yuki宿主机端口>',
    copyCommand: '复制服务器命令模板',
    connectTitle: '使用原有输入框连接',
    connect:
      '填写实际的 HTTPS 网址或粘贴原配对链接，再按原流程确认 Yuki。已有连接可在设置“连接方式”选择“更改…”。',
    skip: '已有可用的服务器地址或配对链接，可以直接继续，不必先完成这份说明。',
  },
} satisfies Chinese<'pairing'>
