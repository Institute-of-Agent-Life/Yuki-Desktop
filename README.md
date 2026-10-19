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
npm test
npm exec playwright install chromium
npm run test:e2e
npm run package:dir
npm run check:package
```

`npm run package` 產生目前平台的安裝檔，設定涵蓋 macOS DMG／zip、Windows NSIS、Linux AppImage／deb／rpm。打包成功、原生平台驗收及簽章發行分別驗證。建置命令預設不發布。

本機資料保存在作業系統的應用程式資料目錄；視窗與外觀偏好使用 SQLite。Renderer 隔離於 Node.js，透過明列的 IPC 操作本機功能。

任務書、調研、設計文件、互動原型與其預覽／檢查材料只在本地維護，不在此發布。安裝包以產品檔案白名單建置，並經封裝內容檢查。測試截圖與 trace 保留在本機暫存目錄。

後端專案：[Yuki](https://github.com/YuanYeYouTao/Yuki)。

授權：[AGPL-3.0-only](LICENSE)。
