# 媒體預覽

事件附件保留 `AttachmentSource(conversationId, eventId, index)`，發布成果保留 `ArtifactSource(artifactId, version)`。圖片、音訊、影片與 PDF 共用 `MediaBody`；文字、原始碼、Markdown 與差異比較沿原有頁面及 Shiki。沒有把兩種來源改成猜測的下載網址。

每次打開先請後端查證本人與原來源，再由現有 `ContentCache` 保存並核對 SHA-256。二進位內容回傳檔名、MIME、雜湊及隨機的 `app://desktop/__media/<id>`，文字仍回傳 bytes 供程式碼與差異比較使用。隨機句柄只在本次預覽有效，不包含本機路徑、憑據或後端 URL。

主程序持有原快取檔案的 FD，處理 `GET`、`HEAD` 和單一 `bytes` Range。每段讀取使用獨立位置；播放器 seek 不重新請求後端，不重新雜湊全檔。預覽關閉、來源替換、角色失活、登出、憑據失效與程式結束會關閉流及句柄。相同 SHA 的不同成果仍有各自的來源身份；撤掉其中一個來源不會連帶關閉另一個合法來源。

`X-Yuki-Expires-At` 是後端臨時原件的回收時間。到點關閉舊句柄並重新查證：後端仍能提供原件時可繼續打開，來源已消失才顯示失效。已過時間後重新授權成功，不進入立即到期、重開的循環。穩定成果沒有這個臨時 TTL。

Client 流的 `sync`／`artifacts` 提示會重新查證已開來源；已知憑據失效會立即收攏。本版 Client 流沒有逐個成果的撤權事件，普通 `conversation` 提示只說明對話投影變更；不因每條新聊天重新下載及雜湊正在播放的大檔案。原事件移除會卸載對應訊息附件。任何新打開都會重新授權，磁碟快取不代替授權。

MIME 依實際宣告、下載中繼資料、附件種類及副檔名解析；通用 `application/octet-stream` 不蓋過可用資料。缺少 MIME 的 `record` WebM 視為音訊。格式確實無法解碼時保留存檔入口，顯示本機預覽失敗。

聊天的圖片按可見區域載入；角色切換復用現有 `useSessionActive`，切回後重新查證。預覽句柄由元件生命週期持有，不留在 Query 快取中。

## Markdown

公式使用本機 KaTeX，支援 `$...$` 與 `$$...$$`。Mermaid 只在可見圖塊載入本機引擎，以 strict 模式產生圖形，不安裝圖中回呼；移除可執行節點、外部圖片及連結。程式碼中的公式字樣保持原文。公式解析錯誤保留原始式子，圖表失敗保留原始碼。

內部圖片引用：

```markdown
![圖片](artifact:<artifact-uuid>@<64位sha256>)
![附件](attachment:<conversation-uuid>/<event-id>/<attachment-index>)
```

它們仍經上述來源 API 查證，不建立外部抓圖服務或檔案系統讀取入口。外部圖片 URL 只顯示為一般連結。原始 HTML 保持關閉。

## 本地驗證

`tests/e2e/rich-media.spec.ts` 使用真正的 Electron、隔離 Yuki API、帳本、快照及投遞流程。固定模型 Provider 只替代付費模型；不是以假的播放器或假 DOM 代替影音解碼。

其中 MP3／OGG 聚焦用例覆蓋事件附件及發布成果的實際播放、seek 和 MIME；`tests/e2e/plugin-notification-media.spec.ts` 將已批准插件的通知原圖，沿真 publish、outbox worker、Client history／files，一直接到桌面顯示及保存，核對原件 SHA。

```powershell
$env:YUKI_BACKEND_TEST_ROOT = '<配套後端工作目錄>'
$env:YUKI_BACKEND_TEST_PYTHON = '<該後端 Python>'
npm run build
npm exec playwright test -- tests/e2e/rich-media.spec.ts
```

測試媒體見 `tests/fixtures/media/README.md`。測試後輸出真正的播放、seek、PDF 頁數、富文字截圖，以及 128 MiB 影片和 500 條歷史的程序 CPU／記憶體記錄；驗證摘要見 [2026-10-28 驗收記錄](reports/2026-10-28-rich-media/README.md)。
