// "Deploy to my server": installing Yuki on the person's server over SSH.
import type { Chinese } from '../types'

export default {
  deploy: '部署到我的服务器',
  deployDescription:
    '有一台云服务器的 IP 与 root 密码就可以：这个 App 经 SSH 安装 Docker 与 Yuki，配对后直接开始对话。',
  title: '部署到我的服务器',
  notBundled: '这份开发构建尚未准备部署包，请使用完整测试包。',
  checkEnvironment: '确认指纹并检查环境',
  environment: '服务器环境',
  system: '系统',
  memory: '内存',
  disk: '可用磁盘',
  mebibytes: '{{value}} MiB',
  dockerInstalled: 'Docker 已安装',
  dockerMissing: '尚未安装 Docker',
  unsupportedSystem: '目前只支持 x86_64 或 arm64 的 Linux 服务器。',
  installDocker: '安装 Docker',
  mirrorExplain:
    '中国大陆的服务器常连不上 Docker 官方源。可以改用国内软件源（阿里云）安装 Docker；确认后重试。',
  mirrorRetry: '改用国内软件源重试',
  prepareImage: '下一步：准备 Yuki 镜像',
  retryStep: '重试这一步',
  characterName: 'Yuki 的名称',
  personName: '你的名称',
  preset: '服务预设',
  sandbox: 'Yuki 的电脑',
  sandboxDesktop: '完整桌面：可观看与接管（约 3 GiB 内存）',
  sandboxHeadless: '无头浏览器（约 1 GiB）',
  sandboxLite: '只有终端与文件（约 512 MiB）',
  sandboxRecommended: '依这台服务器的内存预先选好；内存不足时请选较小的一项。',
  start: '开始部署',
  back: '返回／稍后设置',
  intro: '在你的 Linux 服务器上安装 Yuki，完成后直接开始对话。',
  introDetails:
    '需要 x86_64 或 arm64 的 Linux 服务器（建议 2 GiB 以上内存），以及 root 或可免密码 sudo 的账号。服务器不必连得上 GitHub：安装程序与部署包由这个 App 上传。',
  introSummary: '需要什么',
  summary: '{{os}} {{arch}} · 内存 {{memory}} MiB · 可用磁盘 {{disk}} MiB',
  progress: {
    upload: '上传安装程序与部署包',
    install: '在服务器上安装 Yuki；下载镜像与启动 Yuki 的电脑可能需要几分钟',
    pair: '创建本人入口',
    connect: '建立 SSH 通道并连接',
  },
} satisfies Chinese<'remoteDeploy'>
