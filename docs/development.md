# 開發與驗證

桌面端使用 Electron、React 與 TypeScript，透過版本化個人 API 連接獨立的 Yuki 後端，不包含另一套 Agent Runtime。Renderer 隔離於 Node.js，透過明列的 IPC 操作本機功能；視窗與外觀偏好使用 SQLite。

## 環境與常用命令

開發環境需 Node.js 22.12 以上，使用已提交的 npm lockfile：

```sh
npm ci
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

指定架構、產物檢查與正式簽章程序見 [RELEASING.md](../RELEASING.md)。一般打包不公證；正式 macOS／Windows 設定另行要求簽章，缺少憑證時會失敗。

## 後端契約與聯調

目前 main 需要提供 **Client API revision 11** 與相應實際服務的配套 Yuki 後端，固定來源與 OpenAPI 內容雜湊見 [contracts/source.json](../contracts/source.json)。桌面與後端應使用同一組配套版本；僅更新桌面不會升級後端。以下介紹產品入口及驗證安排，各平台原生操作、安裝包、簽章與部署結果以對應的實際運行記錄為準。

`contracts/` 保存固定版本的 OpenAPI 與來源提交、內容雜湊。`npm run check:contract` 核對快照及生成型別，建置不讀取其他本機倉庫。需要與後端聯調時，可明確指定隔離的測試 checkout 與 Python 環境：

```sh
YUKI_BACKEND_TEST_ROOT=/path/to/test-checkout \
YUKI_BACKEND_TEST_PYTHON=/path/to/test-checkout/.venv/bin/python \
npm run test:e2e -- tests/e2e/backend.spec.ts
```

預設測試依測試宿主分組：`@unix-manager` 需要 Unix socket，Windows 不選取這組；`@linux-supervisor` 另需 Linux `/proc`，macOS 也不選取。混合檔案中的其他案例仍會執行。Windows 客戶端連接 Linux 角色電腦可另跑下述真有頭桌面案例；未選取的宿主案例不算通過。

該測試使用實際 Yuki 應用程式容器、帳本與 App Gateway，在臨時目錄建立測試資料，模型回覆使用固定測試 Provider，不呼叫付費服務。`tests/e2e/agent-connector.spec.ts` 覆蓋統一接入、Codex／Claude 選擇、已有安裝關聯及原實例重試；原生程式、真帳號和三平台服務另行驗收。

`tests/e2e/real-computer-host.spec.ts` 使用 `YUKI_DESKTOP_REAL_BACKEND_URL` 指向操作者另行啟動的隔離測試 API，要求外部真 Manager 與角色桌面，測試不啟停 Manager。`YUKI_DESKTOP_EXECUTABLE` 指定打包程式；故障後可用 `YUKI_DESKTOP_REAL_PROFILE_ROOT` 指定該測試保留的臨時資料目錄，按原 Work ID 接續。測試在真瀏覽器確認完整輸入已到達後才交回，再核對原執行、預算、回執及實際發布的成果內容。

`tests/e2e/real-headed-computer.spec.ts` 可用 `YUKI_DESKTOP_HEADED_BACKEND_URL` 指向已啟動真 Xvnc 與 Chromium 的隔離 API，檢查畫面、接手、實際鍵盤與中文剪貼簿輸入、PNG 截圖、切頁後原控制租約及交回。輸入由遠端瀏覽器的真 HTTP 回傳核對；測試使用臨時 App 設定檔，不啟停該 API，也不代表三平台安裝包或正式環境已驗收。

`tests/e2e/real-computer-lifecycle.spec.ts` 另需 `YUKI_DESKTOP_REAL_MANAGER_RESTART=1`，以兩個實際桌面設定檔驗證純等待跨三個控制租約。測試在輸出目錄寫出各次重啟閘點，由操作者核對後只重啟隔離 Manager；以 Linux 核心的 Unix peer PID 確認真重啟，核對原容器、執行與等待持續，最後交回才接續原工作。測試本身不操作部署服務；已有 L1 等待時可沿保留的兩個設定檔接續，不能用已完成工作重新送出。

`tests/e2e/platforms.spec.ts` 經真後端驗證設定的「平台」頁：被拒憑據的原因、revision 衝突、回應遺失後以原請求號確認、設定目錄不可寫，QQ 官方 Bot／SnowLuma 與三種語言的截圖，以及清單與各平台對話框在淺色／深色、透明磨砂／不透明下與「模型」頁同條件的對照截圖、列樣式量測，以及對話框背後頁面文字的透出量（`platforms-looks.json`；不透明時須為零）。本機部署啟用 SnowLuma 執行後端隨映像附帶的 `deploy/snowluma.sh`，`tests/unit/platforms.test.ts` 在設定 `YUKI_BACKEND_TEST_ROOT` 時以該 checkout 的實際腳本核對它的兩次 Compose 呼叫落在本機部署自己的專案。憑據預檢會以被拒的假憑據實際連到 Telegram 等平台，不呼叫付費服務。舊後端案例另需 `YUKI_BACKEND_PREVIOUS_ROOT` 與 `YUKI_BACKEND_PREVIOUS_PYTHON` 指向 revision 低於 11 的後端 checkout，未設定時跳過。

## 原生殼與平台專項

原生殼驗證可將 `YUKI_ELECTRON_EXECUTABLE` 設為打包後執行檔的絕對路徑，再執行 `npx playwright test --config playwright.shell.config.ts`，不需開發伺服器。測試使用獨立資料目錄並保留 sandbox；Windows 專項要求已登入的互動桌面，檢查視窗按鈕區域、Alt 選單與原生加密跨程序重開。這組檢查不涵蓋安裝、簽章或更新。可用 `YUKI_NATIVE_EXPECT_ARCH` 核對實際 App 程序架構；在已安裝 Rosetta 的 Apple Silicon 測試 x64 包時，另設 `YUKI_NATIVE_EXPECT_TRANSLATION=1`，將轉譯結果與 Intel 真機驗收分開記錄。

Windows 對話相關驗證需 operator 啟動全新隔離的 Yuki 參考服務（`tests.support.desktop_reference_server`，停用電腦夾具），並將其 loopback URL 設為 `YUKI_DESKTOP_NATIVE_BACKEND_URL`。使用同一原生測試設定：

- `windows-onboarding.spec.ts`：720×560 初始視窗目標（保留分數縮放的原生 DIP 捨入量測）、主視覺、欄位與鍵盤配對。
- `windows-client.spec.ts`：配對、送出回應遺失、程序強制結束後沿原 DPAPI／outbox／草稿接回，以及原事件引用刪除。
- `windows-files.spec.ts`：透過實際原生儲存對話框匯出已有對話的診斷，核對敏感內容排除。測試只操作本次 App HWND 子樹，並以原生 PID、控制項 ID 與 owner 核對後輸入，保留真正的對話框回傳。

`windows-avatar.spec.ts` 另需啟用參考服務的角色夾具，將其 `__test/avatar-inputs` 產生的旋轉 JPEG 複製到 Windows，並以 `YUKI_NATIVE_AVATAR_INPUT` 指向該本機檔案。案例走真開啟對話框、EXIF 方向與裁切儲存，核對另一裝置的 SSE 更新及冷重開；不替換選擇器回傳值。

`windows-media.spec.ts` 使用同一隔離服務，走真選檔與另存對話框，注入上傳回應遺失，移除自己建立的兩份輸入後，從第二裝置預覽並核對另存內容的 SHA-256、大小與到期收斂。測試保留設定檔與輸出供查核。

SOUL 測試使用本版後端的 `tests.support.soul_reference_server`，由明確指定的 checkout 與 Python 啟動隔離服務。`prompts.spec.ts` 經實際 Electron 驗證空 SOUL 儲存與強制結束主程序後的原草稿恢復；`windows-prompts.spec.ts` 檢查 Windows 鍵盤儲存。這些案例不呼叫付費模型，不代表其他平台的原生驗收。

`windows-work.spec.ts` 使用全新隔離服務，驗證獨立的問題回答／補充草稿、主程序崩潰恢復、輸入已提交但回應遺失、App 關閉後原 Work 繼續完成，以及重開後從原 namespace 查回同一回執而不重送。

`windows-character-data.spec.ts` 使用全新角色資料服務，經真介面更正記憶、處理兩裝置衝突及忘記，並於回應遺失後強制結束原主程序，核對原請求 ID／雜湊的接續；同時驗證安排 revision、取消後的舊恢復請求、角色名稱衝突與裝置撤銷。

`windows-roles.spec.ts` 另需 `YUKI_DESKTOP_NATIVE_SECOND_BACKEND_URL` 指向第二個獨立參考服務，兩邊均啟用角色與提示詞 fixture。它經原生選圖、真 Yuki 切換、快捷鍵、強制結束及重開，驗證原對話、草稿、頭像裁切狀態、欄寬與 Yuki 切換。

`windows-window-geometry.spec.ts` 從全新配對開始，實際調整原生視窗並讀取 SQLite 已保存的外框位置與尺寸，再強制結束主程序、連續冷重開兩次，核對外框、內容與邏輯視埠不逐次偏移，並驗證移出工作區後的收斂與實際尺寸保存。

`windows-window-controls.spec.ts` 經設定頁切換淺／深主題，擷取本次 App 原生 HWND 的完整像素，量測系統視窗按鈕的對比與視窗尺寸；再以 UI Automation 的真正按鈕執行最大化／還原並核對外框。測試逐次核對程序、執行檔、互動會話與 HWND，不擷取整個桌面。

`native-materials.spec.ts` 使用同一隔離服務與打包執行檔，經真外觀控制驗證側邊欄、內容與原生背景、材質關閉後的冷恢復及再次啟用；原生合成器觀感另行檢查。 `mac-material-contrast.spec.ts` 另以本次 App 的 CGWindowID 擷取系統合成後的視窗，檢查明暗材質、不透明及高對比下的側邊欄文字，不擷取整個螢幕；執行環境需允許視窗擷取。

`native-toolbar-scroll.spec.ts` 以真對話的唯一 5,000 字訊息與原事件，經實際滑鼠滾輪驗證工具列捲動材質、回到頂端、四種外觀及設定頁隔離，再以短訊息確認 Main 回覆可接續；不直接賦值捲動狀態。

`native-message-copy.spec.ts` 以隔離的源 App、macOS 原生右鍵選單及系統剪貼簿驗證選區、全文與 ⌘C。先設定 `YUKI_BACKEND_TEST_ROOT` 和 `YUKI_BACKEND_TEST_PYTHON` 指向固定版後端與其 Python，並在已授予輔助使用權限的互動桌面執行 `YUKI_NATIVE_MESSAGE_COPY=1 npm run test:e2e -- native-message-copy.spec.ts`。輸出包含 `message-copy.json` 和 Playwright trace。

`native-about-layout.spec.ts` 使用啟用角色夾具的全新隔離服務，經設定控制切換外觀，在標準與矮工作區量測角色頁欄寬、記憶排版和小字對比，再從記憶依據按鈕回到同一原始事件。Windows 同時保留核對 PID／HWND 的原生視窗擷取。畫面證據供人工對照；工作區模擬、原生視窗和 OS 顯示縮放分別記錄。

`native-file-layout.spec.ts` 以真服務交付的兩個同名成果驗證列表、原版本預覽與來源跳轉，檢查長檔名保留副檔名、時間／來源可讀及矮工作區的儲存入口。Mac 標準尺寸為 1440×900，Windows 原生檢查採 1360×833，另檢查 1100×760 與 960×492 工作區；後者可能使用 Electron 工作區模擬，證據會明列。Windows 圖片只擷取本次 App 的 HWND。

`native-artifact-actions.spec.ts` 以真後端和實際起拖手勢核對原檔內容、儲存後冷恢復、本機副本刪除及原事件撤銷；系統儲存、顯示及拖放邊界使用記錄器，不能當作 OS 驗收。`windows-artifact-actions.spec.ts` 另走真 Windows 儲存對話框、Explorer 原檔選取及跨程序 FileDrop；接收器與滑鼠路徑都核對本輪 PID、HWND 和工作階段，只接收並複製測試原檔，不操作其他視窗。

`native-work-layout.spec.ts` 從真 Main 建立工作，經外觀設定、列表 Enter、檢視器 Space／Esc 核對來源、步驟與時間的版面和焦點恢復，再回答原問題並核對同一 Work、預算根及原請求結果。Mac／Windows 的原生視窗尺寸與矮工作區模擬分開記錄，Windows 只擷取本次 App 的視窗。`work-components.spec.ts` 另經實際文字輸入驗證超長步驟標籤、狀態圖示與時間，不代替真後端流程。

`native-pairing-availability.spec.ts` 驗證配對前缺少桌面介面的原始 404 提示、憑據未送出與重新嘗試真後端；不把故障注入當正式環境配對成功。

Windows 專項在未提供測試服務或非 Windows 時明確跳過，不讀取部署設定。

安裝包檢查也會驗證 ASAR 內每個封裝檔的 SHA-256 與 Electron 分塊摘要，避免只有目錄及壓縮檔校驗正確、內部程式已損毀的包進入待發行集合。

## 本機 Agent 發現

只驗證本機 Codex 發現、不執行模型任務時，明確設定 `YUKI_REAL_NATIVE_DISCOVERY=1` 與 `YUKI_NATIVE_DISCOVERY_EXPECT_COMMAND`（實際程式絕對路徑），再執行 `npm exec playwright test -- --config tests/live/native-agent-discovery.config.ts`。可另設 `YUKI_NATIVE_DISCOVERY_EXPECT_SOURCE` 核對來源 ID；這些值只作結果斷言，不注入候選。設定 `YUKI_DESKTOP_EXECUTABLE` 可驗收實際打包程式，未設定時使用已建置的源 App 和 `.cache/connector-runtime`。測試啟動隔離 App，經真實 main/preload IPC 發現原生安裝，不配對、註冊服務、連接 daemon 或派發模型任務；記錄留在 `.cache/native-agent-discovery`，與付費任務測試分開。

隔離 profile 只隔離 App 資料。打包程式啟動時仍沿產品行為註冊系統的 `yuki://` 協定，可能把關聯改到測試執行檔；建議使用臨時作業系統帳戶或虛擬機驗收，或在測試後恢復正式安裝的協定關聯。

## 其他 E2E

介面有繁體中文、简体中文與 English，資源與寫法見 [src/shared/locales/README.md](../src/shared/locales/README.md)。E2E 以 zh-TW 系統執行，既有 spec 按繁體文案定位；`languages.spec.ts` 在執行中切換語言，核對選單、托盤、通知、對話框、SC 字形，以及時區、回執 note 與預設檔名不變，並在輸出目錄保留三種語言的設定頁截圖。

SSH 與「部署到我的伺服器」：`prepare-local-bot.mjs` 以後端自己的 `scripts.build_release_bundle` 產生同版本的 `install.sh` 與 `yuki-X.Y.Z-deploy.tar.gz`，放在 `resources/local-bot/server/`（需要 uv）。ssh2 只用純 JavaScript：`electron-builder.yml` 排除其可選原生碼（crypto binding、cpu-features、nan），`check:package` 遇到即失敗。`ssh-connection.spec.ts` 與 `remote-deploy-steps.spec.ts` 以測試內的真 SSH 協定伺服器（ssh2）轉發到隔離後端，覆蓋主機指紋、密碼只在鑰匙圈、重啟後本機連接埠不變、斷線恢復、直接連線與 SSH 互換及各部署步驟的失敗與重試。`remote-deploy.spec.ts` 需要一台可丟棄的 Linux 伺服器：以 `YUKI_TEST_REMOTE_SSH` 傳入 `{host, port, user, key, provideBotImage, provideEnvironmentImage}`，後兩者是在映像加速器提示出現後把映像放進該伺服器的命令；伺服器應連不上 GitHub 與 ghcr.io。輸出目錄保留從部署、對話、升級到第二台桌面經 SSH 配對的截圖序列。

`control-motion.spec.ts` 驗證實際拖曳、取消、鍵盤與背景像素折射；`frosted-workspace.spec.ts` 使用隔離真後端核對四種外觀、三個尺寸、原回執與草稿。兩者均不呼叫付費模型，截圖只作本地審閱。

[開發約束](architecture/development-contract.md)隨原始碼維護。任務書、調研、設計文件、互動原型與其預覽／檢查材料只在本地維護，不在此發布。安裝包以產品檔案白名單建置，並經封裝內容檢查。E2E 在原輸出目錄保留 JSON 報告、每例 trace 與既有流程產物；CI 在 macOS arm64、Windows x64 與 Linux x64 各分三片執行 E2E，獨立上傳 `Yuki-e2e-results-<platform>-<arch>-<shard>`，不加入安裝包或正式 Release；Intel Mac 與 ARM Linux 只執行單元測試與封裝。

## README 展示素材

`img/showcase/` 的截圖、GIF 與影片由 renderer fixture 的 showcase 場景產生，不在 CI 執行：

```sh
PROMO_OUT=/absolute/path/to/out npx playwright test tests/e2e/readme-showcase.spec.ts
python3 build-tools/readme-media.py /absolute/path/to/out img/showcase
```

需要 Pillow；重建影片另需 ffmpeg（libx264）。主倉庫 README 使用同一份素材，更新後一併複製到 Yuki 的 `img/showcase/`。
