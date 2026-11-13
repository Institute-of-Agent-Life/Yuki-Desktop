# 從舊的雙提示詞升級到單一 SOUL

先退出 App，完成後端的單一 SOUL 升級，再更新桌面。桌面執行時不讀取舊提示詞資料表，也不自動補發舊請求。

需要保留尚未送出的舊草稿時，下載本版原始碼並執行 `npm ci`，對每個原角色／Person／Binding 的 outbox 執行一次明確轉換：

```sh
npm run upgrade:soul -- --database /absolute/path/to/original.sqlite3 --source persona
```

`--source` 選擇 `persona` 或 `system_prompt`，直接選用該份原始文字，不拼接兩份衝突內容；選擇 `none` 僅保存原件而不匯入草稿。資料庫位於 App 資料目錄的 `connections/<character>/outbox/<person>/<binding>.sqlite3`。轉換使用本版 Electron 的 SQLite 原生模組，不以系統 Node 直接載入。

工具先在原資料庫旁寫出私有的 `.soul-upgrade.json` 原件，保留兩份草稿及舊 UUID、payload 與 hash，再移除舊資料表。選中的原始文字另存為 `.soul-draft.md`，請開啟新版 SOUL 編輯器，明確貼入並儲存。App 不讀取這兩份匯出原件，執行時沒有舊資料的轉換分支。舊 pending／unknown 可用原 UUID 經既有 `GET /client/v1/requests/{id}` 唯讀查證，不會轉換成新請求，也不阻止新的 SOUL 編輯。備份含私人人格原文，請勿提交或附於一般診斷。
