# Desktop 富媒體驗收，2026-10-28

實作分支：`codex/desktop-rich-media-20261028`。開發基底為 Desktop `1d42784a17bfc09f509e9f50f0f5c0be877b2d7d`，配套後端固定為 [8720d929057cb91290c911d09b282bcd8fa7e394](https://github.com/YuanYeYouTao/Yuki/commit/8720d929057cb91290c911d09b282bcd8fa7e394)。Client API 維持 revision 7。

從該後端 commit 的獨立源碼歸檔實際導出 OpenAPI，內容 SHA-256 仍為 `58462caed2f2fbe63d762d3627645476ab03baa26128982d950d73ba7701280a`，OpenAPI 與產生的 TypeScript 沒有內容差異；只更新 `contracts/source.json` 的固定來源。

## 驗證結果

本機 Windows、Electron 42.11.15、Node 26.1.0。隔離的真 Yuki API、資料庫、App Gateway、快照、投遞、磁碟快取及 Chromium 解碼器參與驗證；固定 Provider 代替付費模型。沒有操作正式服務或發送平台測試訊息。

- `npm run build`、`lint`、`typecheck`、`check:contract` 通過。
- `npm test`：318 通過、3 跳過；跳過不算驗收。
- 真 Electron E2E：`artifacts.spec.ts`、`media.spec.ts`、`rich-media.spec.ts`、`voice.spec.ts`，4 通過，3.6 分鐘。
- 10/29 補充兩個聚焦 E2E：已批准插件通知 joined 鏈路，以及 MP3／OGG 的兩來源播放與 seek。

| 場景                         | 真實檢查                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 事件附件與發布成果 MP4／WebM | Chromium `readyState >= 2`，實際 play 推進時間，seek 到 2.5 秒，再 play 推進到 2.7 秒以上                                                                                |
| 兩種來源的 WAV               | 真解碼、播放、暫停與 seek                                                                                                                                                |
| 兩種來源的 MP3／OGG          | 實際解碼、播放、seek 到 2.5 秒後續播；播放器的真 HEAD MIME 分別為 audio/mpeg／audio/ogg                                                                                  |
| 缺 MIME 的 record WebM       | 經現有錄音上傳與原事件路徑，實際音訊播放與 seek                                                                                                                          |
| Bot 圖片／GIF inline         | 原投遞事件的圖片元素可見、真實解碼寬度非零；原件來源及版本不變                                                                                                           |
| 已批准插件通知原圖           | 安裝倉庫批准 SDK 9.0 測試插件與原 Conversation grant，原 publish／真 outbox worker 交付；Client history／files、Electron inline／檔案頁及保存均核同 artifact/version/SHA |
| 兩種來源的 PDF               | Electron PDF viewer 真正載入一頁，非僅建立 iframe                                                                                                                        |
| 聊天與檔案 Markdown          | 公式可見，程式碼中的 `$literal$` 保持原樣，Mermaid 的 Input／Output 文字可讀，內部圖片成功；壞圖保留原始碼，外部圖片不生成 img                                           |
| 真正到期的原件               | 後端先提供 3 秒回收時間，再移走原件；舊 URL 404、播放器移除，新授權得到原來源不可用                                                                                      |
| 關閉／切角色／切回／冷重開   | 舊 URL 關閉後 404；舊角色 session 保留時也停止資源，切回重新授權，冷重開可重新預覽                                                                                       |
| 128 MiB MP4                  | 實際播放器播放與 seek；IPC 僅 269 bytes 元資料；手動 Range 回傳 206、16 KiB 與精確 Content-Range                                                                         |
| 500 條真實歷史               | 以原 ingress 寫入，再啟動桌面；向上分頁至實際掛載 500 條，記錄程序 CPU／工作集                                                                                           |

截圖：[富文字與可讀圖表](rich-markdown.png)、[128 MiB 影片](large-video-playing.png)。

補充通知用例使用現有 runtime 的 `plugin_notification_repository`、`plugin_media_artifacts` 與 `plugin_notification_outbox`，由真背景 worker 準備並交付原通知，測試不插入投遞事件。原 source event 經 outbox 產生唯一 outbound event；App `local_ledger` 路由保持平台訊息 ID、native message ID 與 origin key 為空，成果引用指向原穩定快照。桌面從這個事件直接解碼 GIF，透過 Client files 找到同一版本，再按真「存到…」按鈕落盤，與 1362 bytes 原件逐字節一致。這次測試後端為 `797b2f37`，其通知／Client／SDK 實作與合同固定來源 `8720d929` 一致。

原回執與保存結果：[通知 joined 記錄](plugin-notification-joined.json)；[桌面檔案頁](approved-plugin-notification-files.png)。MP3／OGG 各四秒，兩來源 seek 後均實際續播到 2.7 秒以上，資料見 [音訊播放記錄](audio-mime-playback.json)。可單獨執行這兩個用例：

```powershell
npm exec playwright test -- tests/e2e/plugin-notification-media.spec.ts tests/e2e/rich-media.spec.ts --grep 'approved plugin|MP3 and OGG'
```

## 資源記錄

原始資料：[影音程序記錄](media-process-metrics.json)、[500 條歷史記錄](history-process-metrics.json)。工作集是 Electron `app.getAppMetrics()` 的 KiB 值；CPU 秒數是程序累積 CPU 的差值，可包含多個執行緒。

128 MiB 影片這次主程序工作集增加約 34.6 MiB，主 renderer 約下降 12.3 MiB。它沒有在 renderer 建立整件影片的 Uint8Array／Blob；269 bytes 元資料和 16 KiB 真 Range 是直接的傳輸證據。工作集含 V8／Chromium 回收及網路緩衝，單次差值不作固定上限。

500 條歷史的後端準備約 19.86 秒，與桌面測量分開。桌面由首頁向上分頁到 500 條約 3.74 秒；主程序增加約 0.62 MiB，renderer 增加約 174.3 MiB，renderer 累積 CPU 約 5.37 秒。歷史列表仍使用現有的完整掛載方式，沒有把新增富媒體誤說成解決既有長列表記憶體。

另以原 Desktop `1d42784` 源碼快照和同一套 Electron／依賴、同一後端、同樣 500 條真事件跑對照。應用程式源碼未改；測試殼的原生 SQLite 載入路徑指向共用的已安裝依賴。原始結果見 [舊版記錄](baseline-history-process-metrics.json)，執行腳本見 [基線測試](baseline-history-performance.spec.ts.txt)。

| 500 條完整掛載      | 原版 1d42784 |  本次修改 |
| ------------------- | -----------: | --------: |
| 分頁到 500 條的時間 |     3.645 秒 |  3.739 秒 |
| renderer CPU        |     5.415 秒 |  5.366 秒 |
| renderer 工作集增加 |    200.1 MiB | 174.3 MiB |
| 主程序工作集增加    |     2.07 MiB |  0.62 MiB |

這組單次對照的分頁時間差約 94 ms，CPU 相近，未看到新增富媒體讓純文字歷史額外膨脹。它也確認現有完整掛載仍有明顯記憶體成本；本次沒有改歷史列表的架構。

## 三輪復審

第一輪沿兩種來源及 MIME 到磁碟、IPC、播放器檢查。刪除不一致的二進位 bytes 白名單與 Blob 複製；保留文字 bytes 及現有差異比較。補 Range 的一般區間、尾端、HEAD、416、實際磁碟位置讀取與解碼測試。

第二輪沿資源生命週期及本人授權檢查。發現舊角色切換只隱藏 session，不能依賴卸載；改用既有 `useSessionActive`。釐清臨時 `expires_at` 是回收時間，不能變成永久禁播。關流等 FD 關閉完成，來源身份與相同 SHA 的共享快取分開，撤權不誤傷另一個合法來源。

第三輪看實際畫面、CPU／工作集及長歷史。截圖抓到 Mermaid 12 的 `flowchart.htmlLabels` 已被根級配置覆蓋，圖形有 SVG 卻沒有字；改為根級 `htmlLabels: false`，增加可讀文字和壞圖原文斷言。一般文字、程式碼與純公式不安裝資源 observer／IPC listener；移除舊圖片／PDF CSS 和已無用途的 Query 失效分支，再跑完整單元及真 Electron 驗證。

10/29 補做深淺主題視覺復核。Mermaid 預設的深色連線在深色背景對比不足，現在連線與箭頭復用 `--text-primary`；覆蓋僅放在現有 Markdown CSS。真 Electron 在設定與對話間連續往返六次，連線／箭頭對比度為淺色 17.0:1、深色 15.1:1。詳見 [淺色截圖](mermaid-light.png)、[深色截圖](mermaid-dark.png) 和 [主題與實際繪製記錄](mermaid-theme-colors.json)。

同時核查全屏縮小預覽中「節點似乎缺字」的疑點。原 PNG 的 Input／Output 字形本來就存在，其區域與後續正確畫面逐像素相同，分別含 71／96 個深色字形像素。[原尺寸局部](mermaid-dark-detail.png) 與 [原圖對照記錄](mermaid-paint-verification.json) 保留了這個證據。回歸測試先截取實際畫面，再讀取文字幾何以定位像素，避免幾何查詢本身影響待驗證的繪製；文字內容、可用邊界、字形像素與白底一起核對。原 SVG 插入方法通過對照，沒有加入重試、延時或主題監聽。

## Client 7 能證明的邊界

新打開、恢復 sync、臨時原件回收時間、已知憑據失效與來源變更會核對原授權或關流。每個 Range 使用同一個已查證的 FD，不碰後端、不重算整件 SHA。

現行 Client 流沒有逐項成果撤權事件，普通 conversation hint 不等同某個成果撤權。此記錄沒有宣稱逐項即時撤銷已驗收；磁碟快取也不能讓新打開跳過授權。沒有為此加入輪詢隊列、另一個 HTTP 服務或新的 Client 協議。

這次驗證的是本機來源程式與配套後端。安裝包、macOS／Linux 原生播放與正式部署不在這份結果內。
