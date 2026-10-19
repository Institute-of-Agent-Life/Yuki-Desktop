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
  invalid_server: '請輸入完整的 http 或 https 伺服器位址。',
  invalid_response: '伺服器回應不完整，請確認這是 Yuki 伺服器。',
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
  control_held: '電腦目前由另一台裝置接手。',
  media_unavailable: '附件內容目前無法取得。',
  upload_pending: '附件尚未完成上傳，內容仍保存在這台電腦。',
  content_hash_mismatch: '附件內容核對失敗，尚未顯示或存檔。',
  local_file_missing: '尚未存到本機，或已存的檔案已移動。',
  open_failed: '系統無法開啟此檔案，請先存到本機並選擇開啟程式。',
  microphone_denied: '麥克風權限未開啟，請到系統設定允許 Yuki 使用麥克風。',
  executor_offline: '這台電腦尚未連線，操作未建立。',
}
export function problemText(code: string): string {
  return messages[code] ?? `操作未完成（${code}）。`
}
