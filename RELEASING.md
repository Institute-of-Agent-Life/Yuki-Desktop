# 桌面建置與發行

一般建置、簽章／公證、原生安裝驗收與對外發布分開執行。所有建置命令使用 `--publish never`。此倉庫的 CI 只產生標為 unsigned 的審閱產物，沒有 GitHub Releases 寫入權，也不持有簽章金鑰。

## 本地產物

使用 Node.js 22.12+、`npm ci` 與已提交的 lockfile。`npm ci` 已安裝 Electron；不需另外下載名為 install-electron 的 npm 套件。

```sh
npm run lint
npm run typecheck
npm run check:contract
npm test
npm run test:release
npm run package -- --mac --arm64 --x64
# Windows x64 原生環境：npm run package -- --win --x64
# Linux 各自原生環境：npm run package -- --linux --x64
#                    npm run package -- --linux --arm64
npm run check:package
node build-tools/prepare-upload.mjs dist/upload dist
```

macOS 產生兩架構各自的 DMG、zip；Windows 為每使用者 NSIS x64；Linux 各架構產生 AppImage、deb、rpm。固定 SQLite 13 使用 Node-API 10 預建模組，打包不重編譯 V8 ABI；beforePack 會核對已安裝版本與目標 Mach-O／PE／ELF 架構及 Node-API 匯出，缺失或不符即失敗。實際 SQLite 執行由 shipped Electron 的單元測試驗證。Linux 打包主機需 rpm 工具；設定明確產生 RPM 4 格式，避免建置主機升級 rpm 後改變套件相容性與解包稽核能力。AppImage 內容審查用固定 builder 的 7-Zip 直接解出 SquashFS，不執行 ELF 或安裝系統套件。Ubuntu 與 Fedora 的實際安裝、Wayland／X11、portal、libsecret、AppIndicator 與縮放仍須原生驗收。

`build-tools/builder-config.mjs` 由版本決定 feed：正式版為 `latest*.yml`，`-beta.N` 為 `beta*.yml`。不要省略這個設定直接呼叫 builder，GitHub provider 不會自行推導 beta feed。檔名使用 `Yuki-<version>-<mac|win|linux>-<架構>.<ext>`；架構沿 builder 的格式慣例：mac／win 為 x64／arm64，Linux x64 的 AppImage／rpm 為 x86_64、deb 為 amd64，Linux arm64 的 rpm 為 aarch64、其他為 arm64。GitHub tag 為 `desktop-v<version>`。App 的 provider 支援此標籤前綴，beta 通道也能採用較新的正式版；兩個通道均禁止降版。

Linux `.desktop` 的名稱與 Electron app_id 使用同一個 `yuki.desktop`。Linux 啟動器會移除 builder AppRun 自動追加的 `--no-sandbox`，保持 Electron sandbox；deb／rpm 的 AppArmor 規則只為安裝目錄內的實際 `yuki-bin` 允許 user namespace，延續 builder 安裝／移除流程；不會關閉 AppArmor 或修改核心設定。AppImage 主機需支援使用者命名空間；不支援時須由 operator 配置平台 sandbox，不能以關閉 sandbox 作為正式解法。維護者名稱使用 Institute of Agent Life，沒有填造聯絡 email；正式發行前需核對套件聯絡資訊。

## 內容與完整性

`check:package` 審查 ASAR 產品白名單。`prepare-upload` 另解開實際 zip、DMG、NSIS、deb、rpm 或 AppImage，檢查外層與解出的 ASAR，核對真正應用程式執行檔的 CPU 與發行檔名一致、Linux 保留已核准的 sandbox 啟動器，再核對 feed 中每個檔案的 SHA-512。它拒絕本地文件／原型路徑、未知待上傳檔案、跨版本／跨平台 feed、缺失檔案、衝突檔名與逃逸路徑。DMG 以唯讀方式掛載並卸載；Windows 審查使用 lockfile 內 electron-winstaller 固定的完整 7-Zip 執行檔與 DLL（builder 的精簡 Windows 7za 缺少 NSIS／CPIO），按建置主機架構取用並只複製到本輪稽核的暫存目錄；NSIS 內部的 app-*.7z 改用 builder 固定新版工具，才能完整解碼 ARM64 filter，仍逐項檢查路徑與內容。其他平台使用 builder 固定工具。RPM build-id 連結逐項核對包內 regular file 目標，不在暫存目錄物化；越界、缺失或異常目標仍拒絕。包裝工具下載走既有 builder 工具鏈。

只上傳新生成的 upload 目錄，不能直接上傳整個 dist、工作目錄、測試報告或暫存目錄。upload 只含安裝檔、對應 blockmap、feed 與 `SHA256SUMS`。產物審查 JSON 寫在旁邊的 `<upload目錄>.local-audit.json`，僅供本地核對，不可上傳或加入 CI artifacts。審查紀錄不等於簽章或原生安裝通過。

合併各原生建置主機已審查的 upload 目錄時，使用：

```sh
node build-tools/prepare-upload.mjs --merge --complete dist/release-upload /path/to/mac-arm64 /path/to/mac-x64 /path/to/windows-x64 /path/to/linux-x64 /path/to/linux-arm64
```

合併會重新核對每個輸入的 SHA256SUMS 及旁邊本地審查 JSON 與檔案雜湊的對應，合併 macOS 兩架構 feed；`--complete` 要求全部十一個安裝檔與四個平台 feed。各原生建置的審查 JSON 必須在 operator 的本地環境保留；不可為了合併把它上傳至公開 CI。unsigned CI 下載檔本身不能當成完整發行驗收。只使用自行審閱、可信建置工作的輸出，JSON 紀錄不提供來源的密碼學認證。輸出目錄必須不存在；不覆蓋先前審閱成果。

## macOS 正式簽章

隨附 Connector 的原始 manifest 在打包前先校驗。正式 Mac 設定委託原 `@electron/osx-sign` 簽內層二進位；在最外層 `.app` 簽章前更新原簽名器實際處理的 runtime 檔案雜湊，再由原簽名器完成 app seal 與嚴格核驗。其他檔案、清單與連結仍須完全相符；不可在 afterSign 修改 manifest。CI 另對臨時副本執行 `node build-tools/check-mac-runtime-signing.mjs dist` 的真實 ad-hoc 簽章與清單檢查，不改 unsigned 發行產物；這不代表 Developer ID、公證或原生安裝驗收。

需已核准的 Apple Developer Program、Developer ID Application 憑證、私鑰及 notarytool 憑據。私密值透過受控環境或 Keychain 提供，不放在命令輸出、倉庫或 upload。`YUKI_MAC_SIGNING_IDENTITY` 為完整 Developer ID 名稱；可透過 builder 的 `CSC_LINK`／`CSC_KEY_PASSWORD` 注入憑證，或使用既有 Keychain。Apple 公證環境組合見[固定 v26 文件](https://www.electron.build/v26/docs/notarization/)。

獲得正式簽章與提交 Apple 的授權後：

```sh
npm run build
npx electron-builder --config electron-builder.release-mac.yml --config.directories.output=dist/release-mac --mac --arm64 --x64 --publish never
node build-tools/finalize-mac.mjs dist/release-mac APPROVED_NOTARY_PROFILE
node build-tools/prepare-upload.mjs dist/upload-signed-mac dist/release-mac
```

正式設定強制簽章、hardened runtime 與 App 公證／stapling。DMG 另簽章，再由明確 operator 命令提交 Apple、staple 及 Gatekeeper 核驗；任何一步失敗都不進入上傳目錄。更新使用已 stapled App 的 zip；正式 DMG 不列入更新 feed／blockmap，避免後續 stapling 改變已列入 feed 的位元組。SHA256SUMS 在這些步驟之後才生成。仍需在乾淨 Mac 驗證下載隔離、DMG 拖入安裝、兩架構啟動及舊版升級保留資料。

## Windows 正式簽章

固定 builder 在複製 extraResources 時已依其原 `shouldSignFile` 選擇簽署 Connector 的 exe。afterPack 以已核驗的來源清單更新這些目標檔案的簽後雜湊，其他檔案仍比對原雜湊，之後繼續原主應用／NSIS 簽章流程。不關閉簽章，也不略過 native 檔案完整性。無憑證本地包只能證明打包／完整性接線，不能宣稱 helper、主應用或安裝器已完成正式 Authenticode。

需已核准的 Azure Trusted Signing 帳戶／certificate profile、Microsoft Entra 身份與簽章費用授權。設定 `YUKI_WINDOWS_PUBLISHER`、`YUKI_AZURE_SIGNING_ENDPOINT`、`YUKI_AZURE_CERTIFICATE_PROFILE`、`YUKI_AZURE_SIGNING_ACCOUNT`；身份透過 Azure 支援的環境憑據提供。publisher 必須與實際憑證一致，以供更新驗證；不能填示意發行者。[v26 Windows 設定](https://www.electron.build/v26/docs/win/)。

```sh
npm run build
npx electron-builder --config electron-builder.release-win.yml --config.directories.output=dist/release-win --win --x64 --publish never
node build-tools/prepare-upload.mjs dist/upload-signed-win dist/release-win
```

在 Windows 檢查安裝檔及應用程式 Authenticode、每使用者安裝與解除安裝、NSIS 差分更新與拒絕失效簽章，並核對原 DPAPI 憑據與 SQLite 資料。配置存在或能產生 exe 不代表這些驗收已通過。

## Linux 校驗與 GPG

完成兩架構 AppImage／deb／rpm 內容核對後，以指定的正式金鑰簽署完整 SHA256SUMS。工具不建立或替換正式金鑰：

```sh
node build-tools/checksums.mjs sign dist/release-upload APPROVED_FULL_FINGERPRINT
node build-tools/checksums.mjs verify dist/release-upload APPROVED_FULL_FINGERPRINT
```

簽署要求六個 Linux 安裝檔均列入校驗。輸出 `SHA256SUMS.asc`、最小公鑰 `SIGNING-PUBLIC-KEY.asc` 與 `SIGNING-KEY.txt`；驗證使用臨時 Keyring，不修改使用者 Keyring。公開指紋須透過可信管道核實，不能只相信同一下載包內的文字。AppImage 使用 Linux feed 更新；deb／rpm 只提示及連到下載頁，1.0 不發布 apt／dnf 套件庫。

## 對外發布前

發行 operator 對照原生驗收紀錄，確認簽章／公證、GPG、安裝與舊版更新、資料保留，以及對應後端的遷移與相容性。後端按自己的倉庫及部署程序處理，桌面建置不讀取兄弟目錄或浮動 main。

正式版使用 `desktop-v<semver>`，beta 使用 `desktop-v<semver-beta.N>` 並標為 prerelease。只在另有發布授權後建立／發布 GitHub Release，附上已審閱目錄的檔案；不要把 unsigned CI 產物當成正式簽章包。此專案不自動推送 tag、建立 Release、上傳發行檔、合併 main 或部署生產。
