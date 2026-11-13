import type { Chinese } from '../types'

// Error codes, keyed by the code itself (snake_case); camelCase keys are not codes.
export default {
  docker_unavailable: '找不到 Docker 或引擎尚未启动。请安装或打开 Docker，再重新检测。',
  docker_linux_required: '请将 Docker 切换为 Linux 容器，再继续部署。',
  local_port_in_use: '这个本机端口已被使用。请选另一个端口，不需要关闭其他服务。',
  local_image_unavailable: 'Yuki 镜像尚未下载完成，请检查网络与 Docker 的镜像来源后重试。',
  local_deployment_failed:
    '这次本机设置或启动未完成。已保留原目录，请检查 Docker 与模型设置后继续。',
  local_existing_deployment:
    '这个目录已有部署或数据。请连接原服务，或为新部署选另一个目录；原数据未改动。',
  local_installation_exists:
    '目前正管理另一个本机部署。请先返回原部署；连接其他服务可使用「连接已有 Yuki」。',
  local_bot_not_bundled: '这份构建未包含配套部署资源，请使用完整桌面测试包。',
  local_bot_not_configured: '尚未选择本机部署，请先完成设置。',
  local_pairing_code_unavailable: '原配对码已签发，明文无法找回。请明确重新获取配对，再继续连接。',
  connector_authorization_unconfirmed:
    '电脑授权码的结果尚未确认。请先查原授权状态，需要新码时重新授权。',
  feature_unavailable: '目前连接的后端尚未提供这项功能。',
  logout_pending: '请先完成这个 Yuki 的退出登录与本机数据选择。',
  unsupported_image: '无法读取这张图片，请选择 PNG、JPEG 或 WebP 图片。',
  image_dimensions: '图片尺寸不符，请重新裁切为 1024 × 1024 像素。',
  invalid_server: '请输入完整的 http 或 https 服务器地址。',
  invalid_response: '服务器响应不完整，请确认这是 Yuki 服务器。',
  client_api_unavailable: '此地址未提供桌面连接界面，请确认地址或更新 Yuki。',
  transport_unknown:
    '无法获取服务器响应。请确认网址与网络；使用 VPN 或 Tailscale 时请先恢复该网络，通过 SSH 的连接会自动恢复。本机内容已保留。',
  unauthenticated: '设备凭据已失效，请重新配对。',
  credentials_unavailable: '系统钥匙串目前无法读取，请解锁后重试。',
  invalid_code: '绑定码无效、已使用或已过期，请重新获取。',
  link_code_invalid: '绑定码无效、已使用或已过期，请重新获取。',
  not_found: '无法读取或查证原项目，原文仍保留。',
  request_conflict: '这个请求的原回执与本机内容不同，已停止重发。',
  version_conflict: '数据已在另一台设备更新，请重新读取。',
  precondition_failed: '目前状态已改变，请重新读取。',
  unavailable: '服务器暂时无法接收，尚未写入。',
  unknown: '状态尚未确认，请查询原回执。',
  internal_failure: '这次处理发生错误，原消息与回执已保留。',
  owner_required: '这项操作目前没有权限。',
  forbidden: '这项操作目前没有权限。',
  outbox_owner_mismatch: '原入口已不属于这位本人，已停止发送。',
  different_person: '这个 Yuki 的原连接属于另一位本人。请先处理原连接的本机数据。',
  server_upgrade_required: '服务器需要升级（api_revision ≥ {{revision}}）。',
  different_character: '这个地址是另一个 Yuki，请确认原 Yuki 的新地址。',
  client_upgrade_required: '这个服务器需要新版桌面 App，请先更新。',
  validation_error: '请检查输入内容。',
  control_held: '电脑目前由另一台设备接手。',
  media_unavailable: '附件内容目前无法获取。',
  upload_pending: '附件尚未完成上传，内容仍保存在这台电脑。',
  content_hash_mismatch: '附件内容核对失败，尚未显示或保存。',
  local_file_missing: '尚未存到本机，或已存的文件已移动。',
  open_failed: '系统无法打开此文件，请先存到本机并选择打开方式。',
  microphone_denied: '麦克风权限未打开，请到系统设置允许 Yuki 使用麦克风。',
  operation_unavailable: '服务器目前无法写入设置，请确认部署目录可写入，再重新保存。',
  // A code this app has no words for yet.
  unknownCode: '操作未完成（{{code}}）。',
  notCompleted: '操作未完成。',
  // Why an attachment's content is unavailable (media_unavailable's reason).
  mediaReason: {
    expired: '已过期',
    cleaned: '已清理',
    source_unavailable: '无法从原平台获取',
    source_changed: '原附件已变更，请重新读取消息。',
  },
} satisfies Chinese<'errors'>
