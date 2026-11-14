# 介面文案（i18n）

桌面端以 i18next + react-i18next 提供繁體中文（`zh-Hant`，來源）、简体中文（`zh-Hans`）與 English（`en`）。Main 與 Renderer 共用這裡的資源；新介面直接按這裡的方式寫，不先寫死再抽取。

## 目錄

```
src/shared/locales/
  index.ts          語言清單、系統語言對應、i18next 選項與 t() 的型別宣告
  types.ts          以 zh-Hant 為準的型別約束
  zh-Hant/<ns>.ts   來源：`export default { … } as const`
  zh-Hans/<ns>.ts   `satisfies Chinese<'<ns>'>`
  en/<ns>.ts        `satisfies English<'<ns>'>`
  */index.ts        匯集該語言全部命名空間
```

命名空間按模組劃分，一個檔案一個：`common`（多處共用的字，如「跟隨系統」、編輯動作）、`menu`（應用程式選單與 Main 彈出的右鍵選單）、`tray`、`notifications`、`dialogs`（Main 的原生對話框）、`localBot`（本機部署進度）、`time`、`settings`、`errors`（錯誤碼，snake_case 的 key 即錯誤碼，`problemText` 先查這裡，SSH 與遠端部署的錯誤碼在 `ssh:problem`；camelCase 的 key 是它自己的字，如 `unknownCode`、`mediaReason.*`）、`presence`（Yuki 的在線狀態）。新畫面新增自己的命名空間（例如 `platforms`、`ssh`），不往別人的檔案裡塞；只有確實多處共用的字放 `common`。後端錯誤以錯誤碼為 key。後端回傳的工作步驟標籤按 `category` 翻譯（`works:step.*`），其他後端中文（自動化描述、記憶更正摘要、「本人」）照原文顯示。

## 新增文案

1. 在 `zh-Hant/<ns>.ts` 加 key（camelCase；同組可用一層巢狀，如 `category.general`）。新命名空間另在三種語言的 `index.ts` 登記。
2. 在 `zh-Hans`、`en` 的同名檔加同一個 key。缺 key、多 key、缺命名空間、英文缺 `_one`，`npm run typecheck` 都會失敗（見 `tests/unit/locales.types.ts`）。不寫執行期兜底，也不設 `fallbackLng`。
3. 简体先用 OpenCC（`tw2sp`）轉換再人工校對用詞：視窗→窗口、連線→连接、設定→设置、檔案→文件、結束→退出、背景→后台、選單列→菜单栏、系統匣→系统托盘、介面→界面（OpenCC 會誤轉成「接口」）、進階→高级（會誤轉成「高端」）。
4. 不拼接句子：每種說法給完整的一句（例如 `operatingBrowser`／`operatingBrowserInBackground`，而不是把「背景」插進去）；名字等變數用插值 `{{name}}`。插值不做 HTML 跳脫（React 自己會跳脫）。
5. 計數用複數：中文只寫 `key_other`，英文寫 `key_one` 與 `key_other`，呼叫 `t('ns:key', { count })`。
6. 介面文案不使用「角色」（三種語言都一樣；英文也不用 character／role）。

型別由 zh-Hant 的 `as const` 推出：`t()` 的 key 與插值變數都會檢查，拼錯即型別錯誤。

## 不屬於介面文案的字

寫給伺服器的回執 note、剪貼簿圖片與截圖的預設檔名、後端回傳的內容都是資料，不放進資源、不隨介面語言變化。各語言的名稱（繁體中文／简体中文／English）用 `languageNames`，不翻譯。

## Renderer

```tsx
import { useTranslation } from '../i18n'

export function Example({ count }: { count: number }) {
  const { t } = useTranslation(['example', 'common'])
  return <Button>{t('example:export', { count })}</Button>
}
```

- 一律從 `src/renderer/i18n.ts` 引入（它保證 i18next 先初始化），命名空間以陣列列出，key 一律寫完整的 `ns:key`。單一字串的 `useTranslation('example')` 不接受 `ns:` 前綴的型別檢查，所以也用陣列。
- 元件外的純函式不自己讀語言：由元件把 `t` 或結果傳進去。
- 日期、數字一律傳目前語言給 `Intl`：日期時間用 `useDisplayTime()`（`date`、`group`、`timeLabel`，並提供 `locale`）；其他數字用 `useTranslation().i18n.language`。不要寫死 `zh-TW` 之類的 locale，也不要傳 `undefined`。
- 時區是另一個設定（`Preferences.timeZone`），切換語言不改時區。

## Main

```ts
import { t } from './i18n'

new Notification({ title: t('notifications:waiting', { name }) })
```

- `src/main/i18n.ts` 匯出 `t`、`language()`、`setLanguage()`。每次建立選單、托盤、通知、對話框時才呼叫 `t`，不要把翻好的字串存起來；需要隨語言更新的原生物件（應用程式選單、托盤）在 `app.ts` 切換語言時重建。
- 語言來源：`Preferences.language`（`system`／`zh-Hant`／`zh-Hans`／`en`，預設 `system`）。`system` 依 `app.getPreferredSystemLanguages()` 的第一個語言：zh-TW/HK/MO/Hant→`zh-Hant`，zh-CN/SG/Hans→`zh-Hans`，其他中文→`zh-Hant`，其他→`en`。
- 切換流程：設定頁 `window.yuki.preferences({ language })` → Main 儲存、`setLanguage`、重建選單與托盤、送出 `yuki:language` → Renderer 的 `applyLanguage` 更新 i18next 與 `<html lang>`（字型由 `tokens.css` 的 `:lang(zh-Hans)` 換成 SC 字形）。不需重啟。

## 測試

E2E 固定以 zh-TW 系統執行（`tests/fixtures/isolated-desktop.ts`），既有 spec 以繁體文案定位。三語切換見 `tests/e2e/languages.spec.ts`，其輸出目錄保留三種語言的設定頁截圖。`tests/e2e/language-layout.spec.ts` 在三種語言 × 淺／深色（不透明）下逐頁截圖（對話、工作、檔案、設定各分類、連線方式對話框、在本機部署、部署到我的伺服器、通過 SSH 連接），量測按鈕、分頁、分段是否撐破自身或超出所在的設定列、對話框、側欄，並檢查簡體與英文介面沒有殘留未抽取的文案（資料除外）。
