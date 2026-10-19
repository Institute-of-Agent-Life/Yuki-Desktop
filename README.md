# Yuki Desktop

Yuki 的跨平台桌面客戶端專案。

使用 Electron、React 與 TypeScript 開發。桌面端透過版本化個人 API 連接獨立的 Yuki 後端，不包含另一套 Agent Runtime。

開發環境需 Node.js 22.12 以上，使用已提交的 npm lockfile：

```sh
npm ci
npm exec install-electron -- --no
npm run dev
```

驗證與本地打包：

```sh
npm run lint
npm run typecheck
npm run check:contract
npm test
npm exec playwright install chromium
npm run test:e2e
npm run package:dir
npm run check:package
```

`npm run package` 產生目前平台的安裝檔，設定涵蓋 macOS DMG／zip、Windows NSIS、Linux AppImage／deb／rpm。打包成功、原生平台驗收及簽章發行分別驗證。建置命令預設不發布。

本機資料保存在作業系統的應用程式資料目錄；視窗與外觀偏好使用 SQLite。Renderer 隔離於 Node.js，透過明列的 IPC 操作本機功能。

開啟 App 後輸入實例的完整網址（可含路徑前綴），確認角色後，貼上綁定碼、完整回覆或 `yuki://pair` 連結。裝置憑據由主程序使用系統金鑰圈加密；Linux 沒有可用金鑰圈時，只保留在本次執行的記憶體，重啟後需重新配對。

待確認訊息與草稿依原角色、本人及 App 入口分開保存在 SQLite。斷線後以原請求 ID 查證回執，只有確認不存在才同號重送；無法查證時保留原文。其他本人入口的歷史唯讀，可引用到桌面對話。最近讀取的內容可離線查看；伺服器確認失去讀權時清除讀快取。

`contracts/` 保存固定版本的 OpenAPI 與來源提交、內容雜湊。`npm run check:contract` 核對快照及生成型別，建置不讀取其他本機倉庫。需要與後端聯調時，可明確指定隔離的測試 checkout 與 Python 環境：

```sh
YUKI_BACKEND_TEST_ROOT=/path/to/test-checkout \
YUKI_BACKEND_TEST_PYTHON=/path/to/test-checkout/.venv/bin/python \
npm run test:e2e -- tests/e2e/backend.spec.ts
```

該測試使用實際 Yuki 容器、帳本與 App Gateway，在臨時目錄建立測試資料，模型回覆使用固定測試 Provider，不呼叫付費服務。

對話可透過「附加檔案」或拖放加入附件；主程序先保存原件快照並核對上傳回執，附件可送出後才建立含附件的訊息。另一台裝置可從原事件預覽及存檔，內容會核對伺服器提供的 SHA-256。到期或原來源無法取得時會顯示原因。

語音按一下開始錄製，再按一下或「結束錄音」完成；Esc 取消。語音使用 Opus／WebM，上傳到目前角色的伺服器。轉寫沿伺服器既有 ASR 設定，沒有轉寫時會如實顯示。

任務書、調研、設計文件、互動原型與其預覽／檢查材料只在本地維護，不在此發布。安裝包以產品檔案白名單建置，並經封裝內容檢查。測試截圖與 trace 保留在本機暫存目錄。

後端專案：[Yuki](https://github.com/YuanYeYouTao/Yuki)。

授權：[AGPL-3.0-only](LICENSE)。
