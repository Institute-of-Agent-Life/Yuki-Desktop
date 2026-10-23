import type { ApiReply } from '../../shared/api'
import { REQUIRED_API_REVISION } from '../../shared/api'

export class ClientProblem extends Error {
  constructor(
    readonly code: string,
    readonly reason?: string,
  ) {
    super(reason && code === 'media_unavailable' ? mediaProblem(reason) : problemText(code))
  }
}
export function unwrap<T>(result: ApiReply<T>): T {
  if (!result.ok) throw new ClientProblem(result.code, result.reason)
  return result.value
}
function mediaProblem(reason: string) {
  return (
    (
      {
        expired: '已過期',
        cleaned: '已清理',
        source_unavailable: '無法從原平台取得',
        source_changed: '原附件已變更，請重新讀取訊息。',
      } as Record<string, string>
    )[reason] ?? '附件內容目前無法取得。'
  )
}
export function hidesPrivateData(error: unknown) {
  return (
    error instanceof ClientProblem &&
    ['unauthenticated', 'not_found', 'outbox_owner_mismatch', 'different_character'].includes(
      error.code,
    )
  )
}
const messages: Record<string, string> = {
  docker_unavailable: '找不到 Docker 或引擎尚未啟動。請安裝或開啟 Docker，再重新檢測。',
  docker_linux_required: '請將 Docker 切換為 Linux 容器，再繼續部署。',
  local_port_in_use: '這個本機連接埠已被使用。請選另一個連接埠，不需要關閉其他服務。',
  local_image_unavailable: 'Yuki 映像尚未下載完成，請檢查網路與 Docker 的映像來源後重試。',
  local_deployment_failed: '這次本機設定或啟動未完成。已保留原目錄，請檢查 Docker 與模型設定後繼續。',
  local_existing_deployment: '這個目錄已有部署或資料。請連接原服務，或為新部署選另一個目錄；原資料未改動。',
  local_installation_exists: '目前正管理另一個本機部署。請先返回原部署；連接其他服務可使用「連接已有 Yuki」。',
  local_bot_not_bundled: '這份建置未包含配套部署資源，請使用完整桌面測試包。',
  local_bot_not_configured: '尚未選擇本機部署，請先完成設定。',
  local_pairing_code_unavailable: '原配對碼已簽發，明文無法取回。請明確重新取得配對，再繼續連接。',
  connector_authorization_unconfirmed: '電腦授權碼的結果尚未確認。請先查原授權狀態，需要新碼時重新授權。',
  feature_unavailable: '目前連線的後端尚未提供這項功能。',
  logout_pending: '請先完成這個角色的登出與本機資料選擇。',
  unsupported_image: '無法讀取這張圖片，請選擇 PNG、JPEG 或 WebP 圖片。',
  image_dimensions: '圖片尺寸不符，請重新裁切為 1024 × 1024 像素。',
  invalid_server: '請輸入完整的 http 或 https 伺服器位址。',
  invalid_response: '伺服器回應不完整，請確認這是 Yuki 伺服器。',
  client_api_unavailable: '此位址未提供桌面連線介面，請確認位址或更新 Yuki。',
  transport_unknown: '無法連到伺服器，已保留本機內容。',
  unauthenticated: '裝置憑據已失效，請重新配對。',
  credentials_unavailable: '系統金鑰圈目前無法讀取，請解鎖後重試。',
  invalid_code: '綁定碼無效、已使用或已過期，請重新取得。',
  link_code_invalid: '綁定碼無效、已使用或已過期，請重新取得。',
  not_found: '無法讀取或查證原項目，原文仍保留。',
  request_conflict: '這個請求的原回執與本機內容不同，已停止重送。',
  version_conflict: '資料已在另一台裝置更新，請重新讀取。',
  precondition_failed: '目前狀態已改變，請重新讀取。',
  unavailable: '伺服器暫時無法接收，尚未寫入。',
  unknown: '狀態尚未確認，請查詢原回執。',
  internal_failure: '這次處理發生錯誤，原訊息與回執已保留。',
  owner_required: '這項操作需要角色擁有者權限。',
  outbox_owner_mismatch: '原入口已不屬於這位本人，已停止送出。',
  different_person: '這個角色已連接另一位本人。請先處理原連線的本機資料。',
  server_upgrade_required: `伺服器需要升級（api_revision ≥ ${REQUIRED_API_REVISION}）。`,
  different_character: '這個位址已是另一個角色，請確認原角色的新位址。',
  client_upgrade_required: '這個伺服器需要新版桌面 App，請先更新。',
  validation_error: '請檢查輸入內容。',
  media_unavailable: '附件內容目前無法取得。',
  upload_pending: '附件尚未完成上傳，內容仍保存在這台電腦。',
  content_hash_mismatch: '附件內容核對失敗，尚未顯示或存檔。',
  local_file_missing: '尚未存到本機，或已存的檔案已移動。',
  open_failed: '系統無法開啟此檔案，請先存到本機並選擇開啟程式。',
  microphone_denied: '麥克風權限未開啟，請到系統設定允許 Yuki 使用麥克風。',
  not_a_directory: '請選擇一個資料夾。',
}
export function problemText(code: string): string {
  return messages[code] ?? `操作未完成（${code}）。`
}
