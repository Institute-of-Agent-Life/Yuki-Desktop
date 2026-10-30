# Yuki Desktop UI 布局与设置重整任务书（2026-10-30，施工版）

> 本文是给执行者（编码 Agent）的**施工说明**，不是讨论稿。每个任务都写明：为什么改、改哪些文件、按什么锚点找代码、逐步怎么改、**不许做什么**、怎么验收。
> 遇到本文没写到的情况：**停下来报告**，不要自行发明机制。

---

## 第 0 章 开工前必读（每次开工都要重读）

### 0.1 基线

1. 本仓库：`D:\Code\My_Github_Repo\Yuki-Desktop`。审查基线 `origin/main` = `b0b4de6`（tag `desktop-v1.0.0-beta.8`）。
2. **每次开工前**执行：
   ```sh
   git fetch origin
   git status -sb          # 必须显示 "## main...origin/main" 且没有 behind
   git pull --ff-only origin main   # 若落后
   ```
   工作区有未提交改动时**先报告，不要 stash/reset/checkout 覆盖**。
3. 从最新 main 拉分支施工，分支名 `codex/ui-<主题>-<日期>`，例如 `codex/ui-terms-20261030`。
4. 后端仓库 `D:\Code\My_Github_Repo\Yuki-QQbot` 只读参考（以其 `origin/main` 为准），本任务**不改后端**。

### 0.2 项目最高约束：禁止防御性编程（逐条执行，不是口号）

本仓库 `AGENTS.md` 与 `docs/architecture/development-contract.md` 的第一条：**禁止防御性编程。能通过删除或放宽现有条件解决的问题，不新增替代代码或机制；非必要不增加代码。**

本次 UI 重整中，以下做法**一律禁止**：

| 禁止 | 正确做法 |
| --- | --- |
| 删组件/改 props 时保留旧 prop "以防万一"（例如保留 `embedded`、`settings`、`onSettingsBack`、`serverRequest`、`agentRequest`） | 直接删除，并修改所有调用处。TypeScript 编译报错就是你的检查清单 |
| 给旧分类 id 写兼容映射（`'security' → 'yuki-devices'`、`'server' → 'yuki-connection'`） | 全仓库搜索旧 id，改掉所有调用者。分类 id 只存在于内存，不需要迁移 |
| 加功能开关在新旧布局间切换 | 只有新布局 |
| 为被改名的 `aria-label` 保留一个隐藏的旧名元素来让旧测试通过 | 修改测试 |
| 在类型已保证非空的值上叠加 `?.` / `?? ''` / `if (!x) return` | 相信类型；类型不对就修类型 |
| 在已有的 `perform()` / `run()` / `act()` 外面再包 `try/catch` | 复用现有错误通道（每个文件已有 `setError`） |
| 新增轮询、定时器、重试来"保证刷新" | 依赖现有 SSE hint（`window.yuki.client.onHint`）与 React Query 的 `refetchOnWindowFocus: true`（见 `src/renderer/src.tsx`） |
| 新增"确定要…吗？"确认框（本文明确要求的除外） | 保持现有确认框数量 |
| 为 connector 新建状态枚举 / 状态机 / store | 从现有 `ConnectorState` 字段**派生**显示文案（纯函数） |
| 前端重复校验后端已校验的输入（URL 格式、码长度等） | 不加 |
| 把设置分类写进 localStorage 并写迁移代码 | 分类状态只在内存（App 组件 state） |
| 新建通用"菜单/下拉/卡片"组件库 | 只新增本文明确列出的两个组件（`SettingsSection`、`PendingRequest`），其余复用 `Controls.tsx` |

**不是防御性编程、必须保留的**（这些是事实与授权，不能删）：

- 所有"未确认请求"仍按**原 request UUID** 查询（`verify*`、`issue(requestId)`、`run(requestId)` 等）。只改呈现，**不改语义**，不生成新 UUID 重发。
- `requestNavigation()` 守卫（SOUL 编辑器有未保存内容时阻止离开）。
- 登出流程的两步确认（撤销凭据 → 保留/删除本机资料）。
- 撤销装置、移除服务、取消原生执行的确认。
- 任何产品功能都不能删除，只能**搬家或合并入口**（前一轮重整的教训：`docs/architecture/Yuki-Desktop-完整产品重整任务书-2026-10-25.md`）。

### 0.3 测试规则（来自 AGENTS.md）

- **不写单元测试补课。** 验证用 E2E（Playwright + Electron）。
- E2E 需要后端测试 checkout：
  ```sh
  YUKI_BACKEND_TEST_ROOT=<后端checkout> YUKI_BACKEND_TEST_PYTHON=<其venv python> npm run test:e2e -- tests/e2e/<spec>.ts
  ```
  未设置时 `yukiFixture()` 会 skip——**skip 不等于通过**，报告里要写明。
- 每个改动过布局的 E2E 结束时必须产出**可复现产物**：截图写到 `test.info().outputPath('<名字>.png')`，结构数据写到 `test.info().outputPath('<名字>.json')`。参考 `tests/e2e/frosted-workspace.spec.ts` 第 150、170 行附近的写法，尺寸用 `tests/fixtures/visual.ts` 的 `workspaceSizes`（1440×900、1100×760、960×492）和 `contentSize()`、`captureViewport()`。
- 每个 PR 至少跑：`npm run lint`、`npm run typecheck`、本 PR 涉及的 E2E spec。

### 0.4 本仓库的几个坑（不知道就会踩）

1. **`aria-label` 被当作 DOM 选择器用。** `src/renderer/components/Workspace.tsx` 里有 `button[aria-label="檢視器"]`、`button[aria-label="側邊欄"]`（`closeInspector` 与 `onPointerDown` 中）。改按钮文案时必须同时改这些选择器。
2. **E2E 用可访问名定位元素**（`getByRole('button', { name: '切換 Yuki', exact: true })`）。改任何按钮/标签文案，都要 `grep -rn "<旧文案>" tests` 并同步修改。
3. **多个 Yuki 会话同时挂载、只有一个 active。** `App.tsx` 用 `<WorkspaceSession active>` + `hidden`/`inert` 隐藏其他会话。`useSessionActive()` 为 false 时：命令不响应（`state/commands.ts`）、Sheet 关闭（`Controls.tsx` `Sheet`）、录音取消（`VoiceRecorder.tsx`）、媒体与富文本暂停加载。改动"什么时候 active"会影响这些行为，必须在 E2E 里验证。
4. **`<Settings key={connection?.characterId}>`**：key 变化会重建设置组件、丢失内部 state。
5. 工作区布局按 scope 存在 `localStorage['workspace-layout/<scope>']`（`state/workspace.ts`），只存宽度和 `inspectorTab`，不要往里加东西。
6. UI 文案一律**繁体中文**。
7. 代码标识符 `characterId`、`character_profile`、`previous-character` 等是**合同/既有命名，不改**。只改用户可见文案。

### 0.5 报告格式（每个 PR 结束时）

分别写：本地修改了什么 / 跑了哪些验证（命令 + 结果，skip 单列）/ 是否提交 / 是否推送 / 是否开 PR。没验证的不要写成"已完成"。未经用户明确授权不推送、不合并。

---

## 第 1 章 概念模型（所有文案和信息架构以此为准）

| 概念 | 后端事实（Yuki 主仓库） | Desktop 现状 | UI 统一称呼 |
| --- | --- | --- | --- |
| **Yuki** | 一个数据库 = 一个永久 Yuki；一个部署 = Bot + 个人 API（`docs/architecture/canonical-runtime.md`） | `Connection`，可连接多个 | 泛指"Yuki"；具体处用该实例的**显示名**（下文记作 `{名字}`，代码里是 `profile.display_name` / `connection.name`） |
| 资料 | `character_profile`：名称、简介、头像、单份 `SOUL.md`；**所有有效配对设备共享、都能编辑**（API7 无 owner 门控） | 关于页 | "名稱""簡介""頭像""人格（SOUL）"、"{名字} 的資料"。**UI 不再出现"角色"** |
| 你 | Person，可有多个平台账号 | — | "你" |
| 入口 | 每个 App 入口有独立 Conversation；同一 Person 的 QQ/TG/飞书私聊也是入口 | 侧栏"對話"+ `home.entries`（桌面只读） | "桌面對話"、"QQ 私聊 · xxx" |
| 装置 | 属于 Person，`purpose = chat \| connector` | 裝置與安全 | "登入的裝置"、"電腦連接器" |
| 主动讯息目的地 | Person 主动路由 | Yuki 連接页 | "{名字} 主動找你時傳到" |
| **{名字} 的電腦** | 服务器上的持久 Linux 有头环境，所有配对客户端共用 | 侧栏"{名字} 的電腦" | "{名字} 的電腦" |
| **這台電腦** | 本机 Agent Connector，归 Person；**同一时间只配对一个 Yuki**（`src/main/agent-connector.ts` `connect()` 遇到他人配对抛 `connector_owner_mismatch`） | 设置"這台電腦"，内含任务控制台 | "這台電腦"；页面写明"目前連接到 {名字}" |
| 本机部署 | Desktop 在本机 Docker 起一个 App-only Yuki | Yuki 連接页里一个按钮 | "在這台電腦部署 Yuki" |

**作用域三层**：应用级（主题、更新、通知）→ **当前 Yuki 级**（连线、装置、这台电脑）→ 内容级（对话、工作、档案、电脑）。现在 UI 没有表达第二层，这是设置混乱的根因。

---

## 第 2 章 现状审查（基于 `b0b4de6`，以锚点字符串定位，行号仅供参考）

### 2.1 设置

| # | 问题 | 位置（锚点） |
| --- | --- | --- |
| S1 | 同一 `<Settings>` 有"嵌入工作区"和"独立全屏"两种外壳；嵌入时出现主侧栏 + 设置分类栏两列导航、三个"設定"标题 | `App.tsx` `settingsInWorkspace`；`Workspace.tsx` `props.settings`；`Settings.tsx` `embedded` |
| S2 | 当前 Yuki 级分类（這台電腦、裝置與安全、Yuki 連接）不显示作用于哪个 Yuki；切换 Yuki 后设置重建回"一般" | `Settings.tsx` `categories`；`App.tsx` `key={connection?.characterId ?? 'desktop'}` |
| S3 | 分类初始值靠两个布尔 prop（`serverRequest`、`agentRequest`）推导，另有 `useEffect` 改分类 | `App.tsx` `serverSettings`/`agentSettings`；`Settings.tsx` `useState<Category>(` |
| S4 | "這台電腦"页把配置、状态、**任务控制台、终端输出、原操作回执**全塞一页，三层 `<details>` | `AgentConnector.tsx` 全文；`ConnectorTasks.tsx`；`ConnectorTerminals.tsx` |
| S5 | 新增 Yuki 有两个文案（"連接已有 Yuki"/"連接另一個 Yuki"）；本机部署混在"Yuki 連接" | `Settings.tsx` `title="連接 Yuki"`、`title="本機 Yuki"`；`ServerSettings.tsx` `title="其他 Yuki"` |
| S6 | 登出在"裝置與安全"底部，标题"這台裝置"，普通按钮 | `DeviceSecurity.tsx` 末尾 `<LogoutFlow`；`LogoutFlow.tsx` `<h3>這台裝置</h3>` |
| S7 | 更新占"一般"顶部；版本号在"進階"重复；"這台電腦"底部又有"Desktop 更新與安裝包" | `Settings.tsx` `<UpdatePanel`、`styles.version`；`AgentConnector.tsx` `Desktop 更新與安裝包` |
| S8 | 调试信息在默认视图：伺服器版本、API 版本、授權來源 URL、背景服務、伺服器接納 | `ServerSettings.tsx` `伺服器版本`；`AgentConnector.tsx` `授權來源` |
| S9 | 手动刷新按钮泛滥：重新讀取（×4 处）、重新讀取目的地、重新讀取裝置、重新讀取狀態、重新讀取原操作、重新讀取終端任務 | 各文件搜索 `重新讀取` |
| S10 | 保存方式不一：主动讯息需"选下拉 → 儲存目的地"；Agent 表单有"保存並重新連接/只保存原設定/改為新增" | `ServerSettings.tsx` `儲存目的地`；`AgentConnector.tsx` `只保存原設定`、`改為新增` |
| S11 | 版式不统一：游离 `h3` + 灰字 + 散落按钮 | `ServerSettings.tsx` `<h3>主動訊息送到哪裡`；`DeviceSecurity.tsx` `<h3>連接另一台裝置` |
| S12 | 危险操作不一致：登出普通按钮；绑定码弹窗底部"另外產生綁定碼"紧挨"完成"；"停止連接器"与"啟動連接器"并排 | `LogoutFlow.tsx`；`DeviceSecurity.tsx` `另外產生綁定碼`；`AgentConnector.tsx` `停止連接器` |
| S13 | 平台文案：Windows 显示"選單列""⌘" | `Settings.tsx` `關閉視窗時保持在選單列`、`⌘ / Ctrl Enter`；`Composer.tsx` `↩ 送出` |
| S14 | 時間顯示 `UTC+8` 排在"跟隨系統"前，且放在"外觀" | `Settings.tsx` `<option value="Asia/Taipei">UTC+8` |

### 2.2 全局与视图

| # | 问题 | 位置 |
| --- | --- | --- |
| G1 | Yuki 切换器是头像卡右上 22px 图标，仅 ≥2 个连接才渲染；点头像卡本身打开"關於" | `RoleSwitcher.tsx`、`RoleSwitcher.module.css .switcher`；`App.tsx` `connections.length > 1 ?`；`Workspace.tsx` `open={() => selectView('about')}` |
| G2 | 侧栏："關於 {名字}"放在"工作與成果"组；设置靠空 `div.group` 分隔；非主对话时多一个"回到桌面對話"按钮（与"對話"重复）；入口样式与导航项不一 | `Workspace.tsx` `sidebarContent`；`Conversation.tsx` `回到桌面對話`、`styles.entry` |
| G3 | "展開工作區"（focusMode）名不副实：实为隐藏侧栏、对话压成 400px、详情放大 | `Workspace.tsx` `展開工作區`；`menu.ts` `展開工作區` |
| G4 | 菜单"關於角色"与 App 的"關於 Yuki"撞名 | `src/main/menu.ts` |
| G5 | 工具列标题与页面 `h2` 重复（"工作""檔案與成果"） | `Works.tsx` `<h2>工作</h2>`；`Files.tsx` `<h2>檔案與成果</h2>` |
| G6 | 未连接首页满是"Bot" | `DisconnectedHome.tsx` |
| V1 | 对话占位文案"正在接入此單元的伺服器介面。"用户可见 | `Conversation.tsx` |
| V2 | 引用条用文字按钮"移除引用"，附件条用 × | `Conversation.tsx` `移除引用` |
| V3 | 档案预览上方先是 artifact ID / 內容版本 / 發布路徑 | `Files.tsx` `artifact ID` |
| V4 | 工作详情"取消工作"夹在预算文字之间；来源筛选文案过长 | `Works.tsx` `取消工作`、`我在桌面交辦的` |
| V5 | 电脑画面缩放按钮显示状态而非动作（"適合/100%"） | `Computer.tsx` `{fit ? '適合' : '100%'}` |
| T1 | 源码 31 处、测试 112 处"角色" | `grep -rn "角色" src tests` |

### 2.3 本轮明确不做（写下原因，避免执行者自作主张）

- **不删除检视器分页（工作/電腦/檔案）**：它承载"边聊边看"的功能，删除会丢能力；只做 T-G3 的改名。
- **不改断点 1100/1180**：`responsive-columns.spec.ts` 覆盖了大量布局事实，改断点影响面大，另立任务。
- **不改 Client API / 合同版本**（本轮实际基线 Desktop 与后端均为 API 7），另立任务。
- **不删双击放大**（工作行、档案行的 `onDoubleClick`）：它只是快捷方式，测试依赖它；只补 `title` 提示。

---

## 第 3 章 目标设计

### 3.1 设置页（单一外壳，全窗口）

设置打开时**替换整个工作区**（隐藏当前 Yuki 会话），不再嵌入。顶部是现有独立 header（返回 + "設定" + 更多命令），下面两列：

```
┌──────────────────────────────────────────────────────────────────┐
│ ← 返回   設定                                              ⋯     │
├───────────────────┬──────────────────────────────────────────────┤
│ 應用程式          │  一般                                        │
│   一般            │  ┌ 啟動 ───────────────────────────────────┐ │
│   外觀            │  │ 登入時開啟                       [●  ] │ │
│   通知            │  │ 關閉視窗後保留在系統匣           [●  ] │ │
│   更新            │  └─────────────────────────────────────────┘ │
│                   │  ┌ 輸入 ───────────────────────────────────┐ │
│ ◉ Diana       ▾   │  │ 送出訊息        [ Enter | Ctrl Enter ] │ │
│   連線            │  └─────────────────────────────────────────┘ │
│   裝置            │                                              │
│   這台電腦        │                                              │
│                   │                                              │
│ 所有 Yuki         │                                              │
│ 進階              │                                              │
└───────────────────┴──────────────────────────────────────────────┘
```

- 左栏分组标题样式复用侧栏 `.group`（11px、600、`--text-tertiary`）。
- 中组标题是当前 Yuki 的**头像 + 显示名**；多个 Yuki 时右侧有 ▾，点开就是 `RoleSwitcher` 的菜单，选中后**留在设置、停在同一分类**。
- 没有连接时，中组整体不显示；"所有 Yuki"页显示"連接已有 Yuki / 在這台電腦部署 Yuki"。
- 右栏内容最大宽 720px，左对齐。

**分类 id 与标题（最终版，不要自行增减）：**

| 组 | id | 左栏文字 | 页面 h2 |
| --- | --- | --- | --- |
| 應用程式 | `general` | 一般 | 一般 |
| 應用程式 | `look` | 外觀 | 外觀 |
| 應用程式 | `notify` | 通知 | 通知 |
| 應用程式 | `updates` | 更新 | 更新 |
| 当前 Yuki | `connection` | 連線 | {名字} 的連線 |
| 当前 Yuki | `devices` | 裝置 | 裝置 |
| 当前 Yuki | `computer` | 這台電腦 | 這台電腦 |
| — | `yukis` | 所有 Yuki | 所有 Yuki |
| — | `advanced` | 進階 | 進階 |

### 3.2 各设置页内容（逐页定稿）

**一般**
- 组"啟動"：`登入時開啟`（逻辑原样保留，含 system-approval 时的"重新讀取"按钮与 `login.isError` 行）；`關閉視窗後保留在{platformTray}`（见 T-P1）。
- 组"輸入"：`送出訊息` Segmented：`Enter` / `{platformModEnter}`。
- 组"時間"：`時間顯示` select，选项顺序 `跟隨系統`、`台北時間（UTC+8）`。值不变（`system` / `Asia/Taipei`），默认值不变。

**外觀**：主题、永遠不透明、減少動態、增加對比（去掉時間顯示）。

**通知**：页顶说明"適用於所有已連接的 Yuki。"；四项文案：`Yuki 主動傳來的訊息`、`等待你回覆的工作`、`工作完成`、`Yuki 的電腦請求協助`。

**更新**：整块 `<UpdatePanel>` 搬过来，包在一个组里。

**連線**（原 `ServerSettings` 改造）
```
組「伺服器」
  伺服器位址      https://…                 [更改…]
  狀態            已連線 / 正在確認… / 無法連線   （無法連線時才出現 [重新檢查]）
組「主動訊息」
  {名字} 主動找你時傳到   [select ▾]   （選了立即提交；行內顯示 正在更新…/已更新/錯誤）
  （未確認請求 → <PendingRequest>）
組「資料」
  {名字} 的名稱、頭像與人格                [開啟]
<details> 技術資訊：伺服器版本、API 版本
組「登出」（危險區）
  登出 {名字}     撤銷這台裝置的登入，再選擇保留或刪除本機資料   [登出…]（destructive）
```
`connection.logout` 为真时，本页只渲染 `<LogoutFlow>`（与现在 DeviceSecurity 的行为一致）。

**裝置**（原 `DeviceSecurity` 改造）
```
說明：這裡列出你在 {名字} 的登入與電腦連接器。撤銷只影響選定的一項。
組「登入的裝置」          ← device.purpose === 'chat'
  MacBook（目前這台）  建立於 …                使用中
  iPhone               建立於 …                [撤銷…]
組「電腦連接器」          ← device.purpose === 'connector'（沒有就不渲染此組）
組「連接另一台裝置」
  產生一次性綁定碼，10 分鐘內可使用一次          [產生綁定碼]
  （有上次發碼紀錄時同一行多一個 plain 按鈕 [查看上次結果]）
  （未確認 → <PendingRequest>）
```
绑定码 Sheet：footer **只留"完成"**；"另外產生綁定碼"改为 body 里、码下方的 plain 按钮"再產生一個"。

**這台電腦**（原 `AgentConnector` 改造，见 T-S6）
```
組「狀態」
  [Laptop] 這台電腦 · {label}     {狀態膠囊}     [唯一主動作]
           目前連接到 {名字}
  背景連接                                       [●  ]   （start/stop）
組「權限」
  允許完整訪問本機  說明…                        [●  ]
組「本機 Agent（可選）」
  本機 Codex   Codex · 原生連線已建立            [編輯]
  本機 Claude  Claude · 目前離線                 [編輯]
                                                [新增 Agent]
（協議不匹配時：Banner + [前往更新]）
<details> 疑難排解：連接器版本/協議、資料目錄、裝置 ID、伺服器協議、接入原有安裝、手動授權碼、移除背景服務、安裝說明連結
```
任务控制台 / 终端 / 原操作回执**全部搬到新视图"這台電腦"**（见 T-L1）。

**所有 Yuki**
```
組「已連接」
  ◉ Diana   https://a.example · 目前使用中
  ◉ Yuki    https://b.example                     [切換]
  ◉ Mio     需要重新配對                           [切換]
組「新增」
  連接已有 Yuki        用配對連結或綁定碼連接       [連接…]
  在這台電腦部署 Yuki  用 Docker 在本機執行一個 Yuki [部署與管理…]
```

**進階**：匯出診斷記錄；舊版操作記錄（原样）。删除底部 `Yuki Desktop {version}` 段落（版本在"更新"页）。

### 3.3 侧边栏

```
┌──────────────────────────┐
│ [头像] Diana          ▾  │  ← 整张卡片是 Yuki 菜单按钮
│        已連線            │
├──────────────────────────┤
│ 對話                     │
│   💬 桌面對話            │
│   💬 QQ 私聊 · 小明      │  ← entries 与导航项同样式（图标 + 13px）
│ 工作區                   │
│   💼 工作                │
│   📁 檔案與成果          │
│   🖥 Diana 的電腦        │
│   💻 這台電腦            │  ← 新视图
│                          │
│ （弹性空白）             │
│   ❄ 關於 Diana           │  ← 固定在底部
│   ⚙ 設定                 │
└──────────────────────────┘
```
Yuki 菜单（点击头像卡弹出）：已连接的 Yuki 列表（单选），分隔线，`連接另一個 Yuki`、`在這台電腦部署 Yuki`、`關於 {名字}`。**只有 1 个 Yuki 时也显示**。

### 3.4 文案总表（T-T1 的唯一依据）

| 文件（锚点） | 旧 | 新 |
| --- | --- | --- |
| `SoulEditor.tsx` `effectExplanation` | `{{name}} 使用目前角色名稱` | `{{name}} 會換成目前的名稱` |
| `SoulCode.tsx` | `title: '目前角色名稱'` | `title: '目前的名稱'` |
| `Settings.tsx` 通知 | `角色主動訊息` | `Yuki 主動傳來的訊息`（其余三项按 3.2） |
| `ServerSettings.tsx` | `選擇你希望收到角色主動訊息的入口。`、`<h3>角色資料</h3>`、`名稱、頭像與提示詞會隨角色保留。`、`開啟角色資料` | 按 3.2"連線"页重写（T-S4），不逐句替换 |
| `LocalBot.tsx` | `角色名稱` | `Yuki 的名稱` |
| `DisconnectedHome.tsx` | 所有 `Bot`；`角色資料會在連接後顯示。` | `Yuki`；`連接後會顯示她的資料。`；`status="尚未連接 Bot"` → `尚未連接 Yuki`；`inspectorTitle` 同改 |
| `Conversation.tsx` 命令面板 | `'開啟角色資料'` | `` `開啟 ${name} 的資料` ``（数组改为在 map 内按 view 生成） |
| `Conversation.tsx` 关于页加载中 | `<EmptyState title="角色資料">` | `<EmptyState title={name}>` |
| `Computer.tsx` | `label="貼上到角色的電腦"` | `label="貼上文字到遠端畫面"` |
| `AvatarStatus.tsx` | `角色頭像`（h2 及 5 句说明） | `頭像`；`伺服器已設定頭像。`；`伺服器尚未提供頭像，目前使用名稱字首顯示。`；`這是 {name} 的頭像，與你的 QQ 或其他平台帳號頭像分開。`；`更換後，連接這個 Yuki 的裝置會同步顯示新頭像。`；`這個 Yuki 目前尚未提供更換頭像的功能。` |
| `About.tsx` | `aria-label="更換角色頭像"` | `aria-label="更換頭像"` |
| `About.tsx` | `aria-label="編輯角色資料"` | `aria-label="編輯名稱與簡介"` |
| `About.tsx` | `<h2 …>角色資料</h2>` | `<h2 …>簡介</h2>` |
| `About.tsx` | `尚未設定角色簡介。` | `尚未設定簡介。` |
| `About.tsx` Segmented | `label="角色資料"` | `` label={`${profile.display_name} 的資料`} `` |
| `About.tsx` 待确认 | `'角色資料變更'` | `'資料變更'` |
| `About.tsx` 冲突 | `角色資料已更新。你的輸入仍保留，儲存仍使用編輯前的版本。` | `資料已在其他地方更新。你的輸入仍保留，儲存仍使用編輯前的版本。` |
| `About.tsx` 能力 | `角色環境`、`提供角色電腦` | `執行環境`、`提供遠端電腦` |
| `queries/client.ts` | `owner_required: '這項操作需要角色擁有者權限。'` | `owner_required: '這項操作目前沒有權限。'` |
| `main/menu.ts` | `'關於角色'` | `'關於目前的 Yuki'` |
| `main/menu.ts` | macOS `{ label: '關於 Yuki', role: 'about' }`、非 mac `{ label: '關於 Yuki', click: … }` | `'關於 Yuki Desktop'`（两处） |
| `main/local-bot.ts` | `'初始化角色與資料庫'` | `'初始化 Yuki 與資料庫'` |
| `main/app.ts` | `'你正在控制角色的電腦'` | `'你正在控制 Yuki 的電腦'` |

改完后 `grep -rn "角色" src` 必须为 0 结果。

---

## 第 4 章 施工任务（按 PR 分组，按顺序做）

> 每个 PR 独立可合并。一个 PR 做完、验证、报告，再开下一个。

---

### PR-1 术语清理 `codex/ui-terms-<日期>`

#### T-T1 移除"角色"与"Bot"

**步骤**
1. 按 3.4 总表逐条替换。`ServerSettings.tsx` 那一行本 PR **只把三句文案替换为**：`選擇 Yuki 主動找你時使用的入口。`、`<h3>資料</h3>`、`名稱、頭像與人格會隨這個 Yuki 保留。`、按钮 `開啟資料`（PR-3 会整体重写）。
2. `grep -rn "角色" src` → 0。`grep -rn "Bot" src/renderer` → 只允许代码标识符（`LocalBot`、`localBot`），不允许出现在用户可见字符串里。
3. `grep -rn "角色\|關於角色\|尚未連接 Bot\|貼上到角色的電腦\|編輯角色資料\|更換角色頭像" tests`，逐个判断：断言的是 UI 文案 → 改成新文案；是测试名/注释 → 顺手改；是 fixture 后端数据 → 不改。

**不许**：改 `characterId` 等标识符；改后端返回的字段名；给旧文案留兼容。

**验收**：`npm run lint`、`npm run typecheck`；E2E：`about-profile.spec.ts`、`avatar.spec.ts`、`characters.spec.ts`、`unconfigured-workspace.spec.ts`、`palette.spec.ts`、`computer.spec.ts`（受影响的都要跑）。

---

### PR-2 设置外壳与信息架构 `codex/ui-settings-shell-<日期>`

#### T-S1 设置只保留全窗口一种外壳

**目的**：消除嵌入模式，删除大量分支代码。

**步骤**
1. `App.tsx`
   - 删除 `settingsInWorkspace` 常量。
   - 设置渲染改为 `{showingSettings && settings}`（原来是 `{showingSettings && !settingsInWorkspace && settings}`）。
   - 每个 Yuki 会话的 `active` 计算加上 `&& !showingSettings`：
     ```ts
     const active =
       item.characterId === connection?.characterId && !pairing && step !== 'local' && !showingSettings
     ```
   - `<Conversation>` 删除 `settings=`、`onSettingsBack=` 两个 prop。
   - `DisconnectedHome` 那段：外层套和其他分支一样的隐藏容器：
     ```tsx
     {!pairing && !connection && step !== 'local' && (
       <div className={styles.roleSession} hidden={showingSettings} inert={showingSettings}>
         <WorkspaceSession scope="desktop" active={!showingSettings}>
           <DisconnectedHome …（删除 settings、onSettingsBack）/>
         </WorkspaceSession>
       </div>
     )}
     ```
   - `<Settings>` 删除 `embedded=`。
2. `Settings.tsx`：删除 `embedded` prop 和 `{!embedded && (` 条件，header 永远渲染。
3. `Workspace.tsx`：删除 props `settings`、`onView`；删除所有引用：`focusMode`/`inspector`/`selectedView` 的 `props.settings ?` 分支、`showingSettings` 及其 `useLayoutEffect`、toolbar `props.scrolled && !showingSettings` 中的 `&& !showingSettings`、`{props.settings ?? props.children}` → `{props.children}`、`selectView` 中的 `props.onView?.()`、`useCommands` 里的 `!props.settings &&`、`floating` 计算里的 `!props.settings &&`。侧栏"設定"按钮的 `aria-current` 删掉（设置已不在工作区内）。
4. `Conversation.tsx`：删除 props `settings`、`onSettingsBack`；删除所有 `settings` 引用：`useEffect(() => { if (settings || view !== 'about' …` 中的 `settings ||`；`useCommands` 开头 `if (settings) return`；palette 两个 effect 里的 `settings`；`toolbar=` 中 `settings ? (…返回…設定…) :` 分支；`onView=`；entries 里 `!settings &&` 与 `if (settings) onSettingsBack?.()`；"回到桌面對話"里的 `if (settings) onSettingsBack?.()`。
5. `DisconnectedHome.tsx`：删除 `settings`、`onSettingsBack` props 与相关分支；toolbar 只剩标题和（PR-5 会删的）设置按钮。
6. `npm run typecheck`，把所有报错修完（报错就是遗漏清单）。

**不许**：保留任何 `settings?: ReactNode` prop；新增"设置覆盖层"组件；为隐藏会话写额外的状态保存逻辑（会话保持挂载，状态自然保留）。

**要特别验证的副作用**（坑 3）：打开设置时当前会话 inactive——
- 输入框草稿在关闭设置后仍在；
- 正在录音时打开设置会取消录音（这是现有 inactive 行为，可接受，报告中写明）；
- 打开设置再关，消息列表滚动位置不变。

#### T-S2 分类状态提升到 App，删除布尔请求 prop

**步骤**
1. `Settings.tsx` 导出类型：
   ```ts
   export type SettingsCategory =
     | 'general' | 'look' | 'notify' | 'updates'
     | 'connection' | 'devices' | 'computer'
     | 'yukis' | 'advanced'
   ```
2. `App.tsx`：
   - 删除 `serverSettings`、`agentSettings` 两个 state。
   - 新增 `const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('general')`。
   - `openSettings` 改为：
     ```ts
     const openSettings = (category?: SettingsCategory) => {
       if (category) setSettingsCategory(category)
       setSettingsOpen(true)
     }
     ```
     （不传参数时保留上次分类 → 自然满足"记忆上次分类"。）
   - `adding()` 里删除 `setServerSettings(true)`。
   - 现有"登出未完成时自动打开设置"：凡是 `setSettingsOpen(true)` 且原因是 `logout` 的地方（`first.logout`、`onResumeLogout`），前面加 `setSettingsCategory('connection')`。
   - `<Settings>`：删除 `serverRequest`、`agentRequest`、`key`；新增 `category={settingsCategory}`、`onCategory={setSettingsCategory}`。
3. `Settings.tsx`：删除内部 `useState<Category>` 和那个改分类的 `useEffect`，改用 props。`connection?.logout` 时强制显示 `'connection'`：`const shown = connection?.logout ? 'connection' : category`。
4. 改所有调用者：
   - `Conversation.tsx` `onSettings(target?: 'agent')` → `onSettings(category?: SettingsCategory)`；命令面板 `onSettings('agent')` → `onSettings('computer')`。
   - `Conversation.tsx` 升级提示 `onSettings()` → `onSettings('updates')`。
   - `Pairing` 的 `onUpdate={openSettings}` → `onUpdate={() => openSettings('updates')}`。
   - `AgentConnector` 的 `onUpdates={() => setCategory('general')}` → `onUpdates={() => onCategory('updates')}`。
   - 全仓库 `grep -rn "'agent'\|'server'\|'security'\|serverRequest\|agentRequest" src/renderer` 清零（`'agent'` 若出现在无关语义中自行判断）。
5. 因为删了 `key`，Settings 内部依赖 connection 的子组件自己已有 `key={connection.characterId}`（`DeviceSecurity`、`ServerSettings`、`AgentConnector`），保留这些子组件 key 即可。

**不许**：旧 id 映射；把分类存 localStorage。

#### T-S3 左栏分组与当前 Yuki 头

**步骤**
1. `Settings.tsx` 把 `categories` 改为分组结构：
   ```ts
   const groups = [
     { label: '應用程式', items: [
       { id: 'general', label: '一般', icon: SlidersHorizontal },
       { id: 'look', label: '外觀', icon: Palette },
       { id: 'notify', label: '通知', icon: Bell },
       { id: 'updates', label: '更新', icon: Download },
     ] },
     { label: null /* 当前 Yuki，渲染头部 */, items: [
       { id: 'connection', label: '連線', icon: Server },
       { id: 'devices', label: '裝置', icon: ShieldCheck },
       { id: 'computer', label: '這台電腦', icon: Laptop },
     ] },
     { label: '', items: [
       { id: 'yukis', label: '所有 Yuki', icon: Snowflake },
       { id: 'advanced', label: '進階', icon: Wrench },
     ] },
   ] as const
   ```
   第二组只在 `connection && !connection.needsPairing` 时渲染。
2. 键盘导航：现有 `onKeyDown` 用 `categories.length`/索引；改为先 `const visible = groups.flatMap(...)` 得到扁平可见列表，索引基于它。`role="tablist"` 与 roving tabindex 行为保持。
3. 第二组头部：`<div className={styles.yukiHeader}>` 内放 `CharacterAvatar size={20}` + `connection.name`，若 `connections.length > 1` 再放 `RoleSwitcher`（需要 `CharacterVisuals.Provider` 包裹，参照 `RoleSwitcher.tsx` 里 `Role` 的写法；或者直接用 `Avatar name={connection.name} size={20}` 避免引入 profile 查询——**选后者**，更少代码）。
4. 切换 Yuki 后留在设置：`App.tsx` 的 `select()` 里有 `setSettingsOpen(false)`。新增参数：`select(value, stayInSettings = false)`，为 true 时跳过 `setSettingsOpen(false)` 和 `setStep('welcome')` 之外的设置关闭。传给 Settings 的是 `(c) => select(c, true)`。
5. CSS（`Settings.module.css`）：新增 `.navGroup`（同 `App.module.css .group`：11px、600、`var(--text-tertiary)`、`padding: 4px 8px; margin-top: 16px`，第一个 `margin-top: 4px`）、`.yukiHeader`（flex、gap 8px、`padding: 4px 8px`、`margin-top: 16px`、`font-weight: 600`、名字单行省略）。`.pane > *` 加 `max-width: 720px`。
6. `SelectionPill selector="button[aria-selected=true]"` 不变。

#### T-S4 页面骨架组件 `SettingsSection`

**步骤**
1. 在 `SettingsRow.tsx` 追加导出（不要新建文件）：
   ```tsx
   export function SettingsSection({ title, description, danger = false, children }: {
     title?: string; description?: string; danger?: boolean; children: ReactNode
   }) {
     return (
       <section className={`${styles.section} ${danger ? styles.danger : ''}`}>
         {title && <h3>{title}</h3>}
         {description && <p className={styles.notice}>{description}</p>}
         <div className={styles.group}>{children}</div>
       </section>
     )
   }
   ```
2. CSS：`.section { margin-bottom: 24px }`、`.section > h3 { margin: 0 0 8px; font-size: 13px }`、`.danger .group { border-color: color-mix(in srgb, var(--status-failed) 35%, var(--separator)) }`。
3. 规则：此后所有设置页**只能**由 `SettingsSection > Row` 组成；需要的按钮放进 Row 右侧；页内提示（成功/失败）放在触发它的 Section 内顶部。**禁止**在 Section 之外出现裸 `<Button>`、裸 `<h3>`、裸 `<p className={styles.notice}>`（页顶一句说明除外）。

#### T-S5 一般 / 外觀 / 通知 / 更新 / 所有 Yuki / 進階

按 3.2 改。要点：
- "一般"三个 Section。`時間顯示` 从外觀移过来，选项顺序改。
- "更新"：`<SettingsSection title="App 更新"><UpdatePanel …/></SettingsSection>`。`UpdatePanel` 内部输出的是 `Row` 和若干 `<p>`/`Banner`，放进 group 里可接受；其中 `<p>開發模式不檢查或安裝更新。</p>` 与 `<p role="status">此通道目前沒有可用的更新。</p>` 改为 `Row` 的 `description` 或放在 group 内，保持 role。
- "進階"删除 `<p className={styles.version}>`。
- "所有 Yuki"：`Settings` 新增 props `connections: Connection[]`、`onSelect(connection)`。每个连接一行 `Row title={c.name} description={c.baseUrl + 状态}`；状态文字：当前 → `目前使用中`；`needsPairing` → `需要重新配對`；`logout` → `登出尚未完成`。非当前 → `[切換]` 调 `onSelect`。下面 Section"新增"两行：`連接已有 Yuki` → `onAddCharacter`；`在這台電腦部署 Yuki` → `onDeployLocal`。
- 删除原 `server` 分类里的"連接 Yuki""本機 Yuki"两行，以及 `ServerSettings` 里的"其他 Yuki"行（入口统一到"所有 Yuki"和侧栏 Yuki 菜单）。

**PR-2 验收**
- `npm run lint`、`npm run typecheck`。
- 修改并跑：`settings.spec.ts`（`getByRole('tab', { name: '一般' })` 等仍可用；新增"更新"tab 断言）、`server-settings.spec.ts`、`device-security.spec.ts`、`logout.spec.ts`、`updates.spec.ts`、`characters.spec.ts`、`unconfigured-workspace.spec.ts`、`agent-connector.spec.ts`。
- **新增** `tests/e2e/settings-layout.spec.ts`：
  1. `yukiFixture()` 两个实例，`pairUI` 连接两个。
  2. 对 `workspaceSizes` 每个尺寸：`contentSize()` → `Ctrl/Cmd+,` 打开设置 → 断言页面上 `navigation[name=主要導覽]` **不可见**、`tablist[name=設定分類]` 可见、只有一个 `getByRole('heading', { name: '設定' })`（header 用 strong 的话断言 header 文本唯一）→ 依次点击每个可见 tab，`captureViewport()` 存 `settings-<id>-<w>x<h>.png`。
  3. 在"連線"页通过 Yuki 头部 ▾ 切到第二个 Yuki，断言仍在设置、仍选中"連線"、h2 变为第二个 Yuki 的名字。
  4. 关闭设置再打开，断言选中的仍是上次分类。
  5. 输入框写入草稿 → 打开设置 → 关闭 → 断言草稿仍在。
  6. 写 `settings-layout.json`：每个尺寸下 tab 列表（id、文字、组）、pane 的 `getBoundingClientRect`。

---

### PR-3 当前 Yuki 的"連線""裝置"页 `codex/ui-settings-yuki-<日期>`

#### T-S6a 组件 `PendingRequest`

在 `SettingsRow.tsx` 追加：
```tsx
export function PendingRequest({ text, busy, onVerify }: {
  text: string; busy: boolean; onVerify(): void
}) {
  return (
    <Row title={text} description="結果尚未確認，會以原請求查詢，不會重新送出。">
      <Button loading={busy} onClick={onVerify}>重新確認</Button>
    </Row>
  )
}
```
替换：`ServerSettings.tsx` `主動路由變更：結果尚未確認。` 那段；`DeviceSecurity.tsx` `裝置撤銷：結果尚未確認。`、`發碼結果尚未確認，原請求已保留。` 两段。`onVerify` 传原来的函数（`run(item.requestId)`、`revokeDevice(deviceId, item.requestId)`、`issue(item.requestId)`），**一个字都不改语义**。

#### T-S6b 「連線」页（重写 `ServerSettings.tsx` 的 JSX，逻辑函数保留）

**步骤**
1. 保留：`info`/`me`/`route`/`commands` 查询、`refresh`、`outcome`、`run`、地址修改 Sheet 及其逻辑。
2. 删除：`reloadRoute`、"重新讀取目的地"按钮、"儲存目的地"按钮。
3. 主动讯息 select 的 `onChange` 改为**选中即提交**：
   ```ts
   onChange={(event) => {
     const next = { binding: event.target.value, revision: draft?.revision ?? route.data!.revision }
     setDraft(next)
     setNotice('')
     void submitRoute(next)
   }}
   ```
   把 `run()` 中"新提交"分支抽成 `submitRoute(next)`（参数化 `draft`），`run(requestId)` 只保留查证分支。提交失败时 `setDraft(undefined)` 让 select 回到 `route.data.binding_id`（这就是"回滚"，不需要额外状态）。
4. "狀態"行：`重新讀取` 按钮只在 `info.isError || me.isError` 时渲染，文案改 `重新檢查`。
5. 技术信息：`<details><summary>技術資訊</summary>` 内放 `伺服器版本`、`API 版本` 两个 Row（`details` 放在 group 外、Section 之间，样式用现有 `<details>` 即可）。
6. "資料"Section：一行 `{名字} 的名稱、頭像與人格` + `[開啟]`（调用 `about`）。`{名字}` 用 `me.data` 里没有角色名——**用 `connection.name`**。
7. 危险区：`<SettingsSection title="登出" danger>` 内放 `<LogoutFlow>`。修改 `LogoutFlow.tsx` 的非 logout 分支 JSX：删除 `<h3>這台裝置</h3>` 和那句 notice，改为
   ```tsx
   <Row title={`登出 ${connection.name}`} description="撤銷這台裝置的登入，再選擇保留或刪除本機資料。">
     <Button variant="destructive" disabled={busy} onClick={() => setConfirm(true)}>登出…</Button>
   </Row>
   ```
   logout 分支（`connection.logout`）保留"繼續登出"按钮与说明，同样包成 Row。三个 Sheet 不动。
8. `Settings.tsx`：`'connection'` 分类渲染 `ServerSettings`；当 `connection.logout` 时只渲染 `<LogoutFlow>`。
9. `DeviceSecurity.tsx` 删除末尾的 `<LogoutFlow …/>` 与 `connection.logout ?` 分支（登出已搬走），以及 `import { LogoutFlow }`。

#### T-S6c 「裝置」页（`DeviceSecurity.tsx`）

1. 设备按 `purpose` 分两个 `SettingsSection`：`登入的裝置`（`chat`）、`電腦連接器`（`connector`，为空不渲染）。`purposeLabel` 函数和 description 里的用途前缀可删（分组已表达）。当前设备标题后缀 `（目前桌面登入）` → `（目前這台）`。
2. 删除"重新讀取裝置"按钮（已有 `onHint` 刷新 + 窗口聚焦刷新）。
3. "連接另一台裝置"Section：一行 Row，右侧 `[產生綁定碼]`；有 `codes.data?.at(-1)` 时同 Row 再放 plain `[查看上次結果]`。
4. Sheet：`actions` 只留 `<Button variant="primary" autoFocus onClick={close}>完成</Button>`；在 body 码区域下方加 `<Button variant="plain" disabled={busy || lost} onClick={() => void issue()}>再產生一個</Button>`。
5. 撤销按钮文案 `撤銷…` 保持，`variant` 不变（destructive 在确认 Sheet 里）。

**PR-3 验收**：`server-settings.spec.ts`（主动讯息改为选中即提交：断言选择后出现"主動訊息目的地已更新。"，且没有"儲存目的地"按钮）、`device-security.spec.ts`（分组、Sheet 底部只有"完成"）、`logout.spec.ts`（入口改在"連線"页）、`settings-layout.spec.ts` 重新截图。

---

### PR-4 「這台電腦」：设置瘦身 + 新视图 `codex/ui-local-computer-<日期>`

#### T-L1 新视图 `local`（"這台電腦"）

**为什么**：原生 Agent 的权限请求（`NativeRequest`）需要及时回应、终端输出需要观察——这些是"工作中的活动"，放在设置里用户根本看不到。

**步骤**
1. `src/shared/desktop.ts`：`View` 增加 `'local'`。
2. `src/main/menu.ts` "顯示"菜单：在"電腦"后插入 `{ label: '這台電腦', accelerator: 'CmdOrCtrl+6', click: send('local') }`；`'電腦'` 改为 `'Yuki 的電腦'`。
3. `App.tsx` `useCommands` 中 `['chat', 'works', 'computer', 'files', 'about']` 加 `'local'`。
4. `Workspace.tsx` `views` 数组在 `computer` 后加 `['local', '這台電腦', Laptop]`。（侧栏结构 PR-5 再调。）
5. 新文件 `src/renderer/views/LocalComputer.tsx`：
   ```tsx
   export function LocalComputer({ connection, openSettings }: {
     connection: Connection; openSettings(): void
   }) {
     const state = useQuery({
       queryKey: ['desktop', 'agent-connector', connection.characterId],   // 与 AgentConnector 共用缓存
       queryFn: () => window.yuki.connector.state(connection.characterId).then(unwrap),
       retry: false,
     })
     const available = state.data?.available ? state.data : undefined
     if (state.isPending) return <EmptyState title="這台電腦"><Spinner /></EmptyState>
     if (!available?.paired || available.admission?.matched !== true)
       return (
         <EmptyState title={`這台電腦尚未連接到 ${connection.name}`}
           action={<Button variant="primary" onClick={openSettings}>前往設定</Button>}>
           連接後，{connection.name} 可以在這台電腦執行命令、使用 Codex、Claude 或 ACP Agent。
         </EmptyState>
       )
     return <div className={styles.page}><ConnectorTasks connection={connection} state={available} /></div>
   }
   ```
   `styles.page`：新建 `LocalComputer.module.css`，`.page { overflow: auto; padding: 24px; max-width: 880px }`。
6. `Conversation.tsx` 视图分支：在 `view === 'files' && !focusMode ?` 前加 `view === 'local' && !focusMode ? (<LocalComputer connection={connection} openSettings={() => onSettings('computer')} />) :`。`EmptyState` 兜底分支的 title 映射加 `'local'`（或者直接删掉那个"正在接入此單元"兜底——见 T-V1）。
7. `DisconnectedHome.tsx` 的 `title`/`Icon`/文案三元式加 `local` 分支：`這台電腦` / `Laptop` / `連接 Yuki 後，可以讓她使用這台電腦。`。
8. `AgentConnector.tsx` 删除 `<ConnectorTasks …/>` 及其 import。
9. `ConnectorTasks.tsx` 顶部加 `Segmented`（`label="這台電腦的活動"`，items：`原生 Agent 任務`、`終端執行`），切换显示原生任务区或 `ConnectorTerminals`，默认"原生 Agent 任務"。不改任何提交/查证逻辑。
10. 两个文件里的"重新讀取原操作""重新讀取終端任務"保留为页面右上一个 plain 按钮"重新整理"（每个 tab 一个），文案统一。

**不许**：复制 ConnectorTasks 代码；为 LocalComputer 新增全局 store；改 connector IPC。

#### T-S7 「這台電腦」设置页瘦身（`AgentConnector.tsx`）

**步骤**
1. 写一个纯函数派生状态（同文件内）：
   ```ts
   const summary = (s: ConnectorState | undefined) =>
     !s ? { text: '讀取中', status: 'unknown' as const }
     : !s.available ? (s.existing ? { text: '發現原有連接', status: 'waiting' } : { text: '尚未連接', status: 'offline' })
     : s.paired && s.admission?.matched === false ? { text: '已連接到其他 Yuki', status: 'failed' }
     : s.updateAvailable ? { text: '需要更新', status: 'waiting' }
     : !s.service.installed || s.service.running === false ? { text: '背景連接已停止', status: 'waiting' }
     : s.admission?.connected ? { text: '已連線', status: 'done' }
     : { text: '尚未確認連線', status: 'unknown' }
   ```
   （字段名以 `src/shared/connector.ts` 实际定义为准；若不一致，按真实字段改，不要猜。）
2. 页面结构按 3.2：
   - Section「狀態」第一行：`Row title={`這台電腦 · ${label}`} description={connection ? `目前連接到 ${connection.name}` : undefined}`，右侧 `<StatusPill>` + **唯一主动作**：
     - 未连接 → 原"連接這台電腦"表单（名称 TextField + 同意 checkbox + 提交）挪到这个 Section 内的下一行。
     - 发现原有连接 → `使用已有連接`（原逻辑）。
     - 需要更新 / managed false → 原"更新連接器，保留原資料 / 改用隨附版本，保留原資料"按钮。
     - 已连接到其他 Yuki → 原"建立新連接"按钮，description 写 `這台電腦目前連接到另一個 Yuki；一台電腦同一時間只能連接一個 Yuki。`
   - 第二行（仅已配对）：`Row title="背景連接" description="關閉 Desktop 後仍持續連線。"` + `Toggle checked={available.service.running === true}`，`onChange` → `service(enabled ? 'start' : 'stop')`；未安装服务时 `onChange(true)` 先 `service('install')` 再 `service('start')`（在同一个 `perform` 里顺序调用）。删除原"安裝目前使用者的背景服務/啟動連接器/停止連接器"三个按钮。
   - Section「權限」：完整访问 Toggle（原逻辑与 notice 原样）。`fullAccess === undefined` 的提示作为该 Row 的 description。
   - Section「本機 Agent（可選）」：
     - 每个实例一行：`title=label`，`description=driverName + ' · ' + 状态文字`（原状态三元式），右侧只有 `[編輯]`。
     - 列表下一行 `[新增 Agent]`。
     - "編輯"/"新增"打开一个 `Sheet`（`width={560}`，标题 `編輯 {label}` / `新增本機 Agent`），把原 `<form>` 的字段搬进去：类型 select（编辑时 disabled）、`尋找已安裝的 X` + 候选、显示名称、`<details>進階：手動選擇原生程式`、ACP 参数。Sheet 内另放两个 plain 按钮（编辑时）：`檢查就緒`（codex/claude）、`開啟程式位置`。诊断 Banner 显示在 Sheet 内。
     - Sheet footer：`取消`、`儲存`（primary，submit）。`儲存` 调 `save(available.service.running !== false)`。删除"只保存原設定""改為新增"。新增入口重置 state 的代码就是原"改為新增"按钮的 onClick 内容，搬到"新增 Agent"按钮。
   - 协议不匹配 Banner 保留在页面顶部（它是要用户动手的），里面按钮改 `前往更新` → `onUpdates`。
   - `<details><summary>疑難排解</summary>`：原"進階：安裝與原有連接"全部内容 + 原"進階：手動專用授權碼" + `授權來源`、`伺服器接納` 两行 + 安装说明链接按钮。
3. 删除：页面底部"重新讀取狀態"、"Desktop 更新與安裝包"按钮；顶部长说明缩成一句 `讓 {名字} 使用這台電腦的命令、檔案與已安裝程式。Codex、Claude、ACP 是可選的。`。
4. `existing` 那组里"原連接器版本/原背景服務/原伺服器連線"三行移进疑难排解。

**PR-4 验收**：`agent-connector.spec.ts`（大改：服务改 Toggle、Agent 改 Sheet、任务在新视图）、`native-request.spec.ts`、`native.spec.ts`；新增 `tests/e2e/local-computer.spec.ts`：未配对时空状态与"前往設定"跳到 `computer` 分类；配对后（参照 `agent-connector.spec.ts` 现有配对步骤）新视图出现两个 tab；产出 `local-computer-*.png` 与 `local-computer.json`（记录 tab 名、是否出现 NativeRequest）。

---

### PR-5 侧边栏与 Yuki 菜单 `codex/ui-sidebar-<日期>`

#### T-G1 头像卡即 Yuki 菜单

**步骤**
1. `RoleSwitcher.tsx` 改为接收 `trigger: ReactNode`（头像卡内容）并把**整张卡**作为 `aria-haspopup="menu"` 按钮：按钮可访问名用 `` `${name}，切換 Yuki` ``……**注意**：现有测试找 `name: '切換 Yuki'`。决定：按钮 `aria-label="切換 Yuki"`，卡片里的名字和状态用 `aria-describedby` 关联，这样测试无需大改。
2. 菜单项：现有 `Role` 列表 + 分隔 `<div role="separator" />` + 三个 `role="menuitem"` 按钮：`連接另一個 Yuki`（`onAdd`）、`在這台電腦部署 Yuki`（`onDeploy`）、`` `關於 ${name}` ``（`onAbout`）。键盘上下键遍历现在只找 `menuitemradio`，改为 `[role="menuitemradio"],[role="menuitem"]`。
3. 菜单定位：`.menu { left: 0; top: calc(100% + 4px); width: 100% ; min-width: 240px }`，删除 `left: -202px`。`.switcher` 不再 absolute。
4. `PresenceCard.tsx`：删除 `open` prop 与 button 分支，只渲染 `div`（成为 RoleSwitcher 的 trigger 内容）。
5. `Workspace.tsx`：`sidebarContent` 顶部改为 `{props.roleSwitcher ?? <PresenceCard …/>}`；`App.tsx` 给 Conversation 传 RoleSwitcher **不再判断 `connections.length > 1`**，并传入 `onAdd={adding}`、`onDeploy={deployLocal}`、`onAbout`（`workspaceFor(scope).getState().setView('about')`）、`trigger`（PresenceCard 需要 name/status/avatar——在 Conversation 里构造 trigger 更合适：改为由 `Conversation` 把 `PresenceCard` 作为 `trigger` 传给 `roleSwitcher` 渲染函数。实现方式：`roleSwitcher?: (trigger: ReactNode) => ReactNode`）。
6. `DisconnectedHome`：`connections.length` 为 0 时也渲染 RoleSwitcher（菜单只有三项新增/部署/关于 Yuki Desktop 不适用——"關於"项在未连接时不渲染）。
7. `role-switcher.spec.ts`、`characters.spec.ts`（其中 `toHaveCount(0)` 的断言改为"单个 Yuki 时也存在"）。

#### T-G2 侧栏分组

`Workspace.tsx` `sidebarContent` 改为：
1. 组"對話"：`桌面對話`（原"對話"按钮文案改为 `桌面對話`，`aria-current` 逻辑不变）+ `props.entries`。
2. 组"工作區"：`works`、`files`、`computer`（`${name} 的電腦`）、`local`（`這台電腦`）——按此顺序，不再用 filter 推导。
3. `<div className={styles.navSpacer} />`（`flex: 1`）。
4. 底部：`關於 ${name}`、`設定`。
5. 删除空 `<div className={styles.group} />`。
6. `Conversation.tsx` entries：按钮加平台图标（`MessageCircle` 即可，不新增图标库），class 改用 `appStyles.nav`（从 `../App.module.css` 引入）使其与导航项同样式；文案 `` `${item.platform.toUpperCase()} 私聊 · ${item.display_name}` ``。删除"回到桌面對話"`<Button>`（"桌面對話"导航项就是它）。`Conversation.module.css` 的 `.entry` 若无引用则删除。
7. `views` 常量中 `chat` 的 label 改 `桌面對話`（工具列标题在 chat 时显示名字，不受影响）。

#### T-G3 命名：focusMode 与检视器

| 位置 | 旧 | 新 |
| --- | --- | --- |
| `Workspace.tsx` 工具列按钮 label | `展開工作區` / `收合工作區` | `放大詳情` / `還原版面` |
| `menu.ts` | `展開工作區` | `放大詳情` |
| `Conversation.tsx` 命令面板 | `展開或收合工作區` | `放大或還原詳情` |
| `Workspace.tsx` 按钮 / aside / 关闭 | `檢視器`、`關閉檢視器`、`檢視器內容`、`調整檢視器` | `詳情`、`關閉詳情`、`詳情內容`、`調整詳情寬度` |
| `menu.ts` | `檢視器` | `詳情面板` |
| `Conversation.tsx` 命令面板 | `開合檢視器` | `開合詳情面板` |
| `Workspace.tsx` 选择器字符串（坑 1） | `button[aria-label="檢視器"]` | `button[aria-label="詳情"]`（两处） |

然后 `grep -rn "檢視器\|展開工作區\|收合工作區" src tests` 全部更新（测试约 55+8 处）。工作行/档案行加 `title="按兩下放大詳情"`。

**PR-5 验收**：`role-switcher.spec.ts`、`characters.spec.ts`、`chat-navigation.spec.ts`、`responsive-columns.spec.ts`、`workspace-layout.spec.ts`、`computer-preview.spec.ts`、`palette.spec.ts`、`unconfigured-workspace.spec.ts`；`settings-layout.spec.ts` 增加侧栏截图 `sidebar-<w>x<h>.png`（单 Yuki 与双 Yuki 各一张），JSON 记录侧栏按钮顺序。

---

### PR-6 视图细节 `codex/ui-views-<日期>`

| 编号 | 任务 | 步骤 |
| --- | --- | --- |
| T-V1 | 删除占位兜底 | `Conversation.tsx` 中 `view !== 'chat' && !focusMode ? (<EmptyState … 正在接入此單元的伺服器介面 …>)` 分支：所有 view 都已有明确分支（chat/works/computer/files/about/local），此分支不可达，**直接删除**，让最后的 `:` 落到 chat 渲染。若 TypeScript 报穷尽性问题，说明还有漏掉的 view，补分支而不是加兜底 |
| T-V2 | 引用条 × | `Conversation.tsx` `移除引用` 的 `<Button variant="plain">` 改为 `<IconButton label="移除引用"><X size={14} /></IconButton>`（可访问名不变，测试不用改） |
| T-V3 | 档案元数据后置 | `Files.tsx`：把 `<section className={styles.info}>`（含 artifact ID、內容版本、發布路徑、傳送過的訊息、比較）整体移到 `<div className={styles.preview}>` **之后**；artifact ID / 內容版本 / 發布路徑三段包进 `<details><summary>詳細資料</summary>`；"在資料夾顯示""複製""傳送過的訊息""比較"保持在外 |
| T-V4 | 工作页 | `Works.tsx`：删除列表 `<h2>工作</h2>`（工具列已有标题）；Segmented 文案 `全部`/`桌面`/`其他入口`；详情里"取消工作"按钮移到 `<StatusPill>` 同一行右侧（包一个 flex 行），预算 `<p>` 改为 `<details><summary>用量</summary>…</details>` |
| T-V5 | 档案页标题 | `Files.tsx` 删除列表 `<h2>檔案與成果</h2>` |
| T-V6 | 缩放按钮 | `Computer.tsx` `{fit ? '適合' : '100%'}` → 按钮文字 `{fit ? '縮放：適合' : '縮放：100%'}`，`aria-pressed={!fit}` |
| T-V7 | 未连接首页 | `DisconnectedHome.tsx` 删除工具列"設定"按钮（侧栏底部已有） |

**验收**：`artifacts.spec.ts`、`native-file-layout.spec.ts`（仅能在原生环境跑则写明 skip）、`work-components.spec.ts`、`computer-toolbar.spec.ts`、`unconfigured-workspace.spec.ts`。

---

### PR-7 平台文案 `codex/ui-platform-<日期>`

#### T-P1

1. `Settings.tsx` 已有 `boot.platform`。定义：
   ```ts
   const tray = boot.platform === 'darwin' ? '選單列' : '系統匣'
   const modEnter = boot.platform === 'darwin' ? '⌘ Enter' : 'Ctrl Enter'
   ```
   用于 `關閉視窗後保留在${tray}`（Toggle 的 label 同步）和送出键 Segmented。
2. `Composer.tsx` 没有 platform：从 `Conversation` 传入 `platform` prop（`Conversation` 已有 `platform`）。提示改为：
   - mac：`commandEnter ? '⌘↩ 送出' : '↩ 送出 · ⇧↩ 換行'`
   - 其他：`commandEnter ? 'Ctrl+Enter 送出' : 'Enter 送出 · Shift+Enter 換行'`
   `WorkReply`（`Works.tsx`）若也显示同类提示，同样处理（搜索 `↩`）。
3. `grep -rn "⌘\|↩" src/renderer` 逐个确认都已按平台分支。

**验收**：`settings.spec.ts`（在 win32/linux 断言"系統匣"、"Ctrl Enter"）、`windows-client.spec.ts`（原生 Windows 才能跑，写明）。

---

## 第 5 章 验收总表

| 走查任务（非开发者 3 分钟内完成） | 期望路径 |
| --- | --- |
| 只有 1 个 Yuki 时连接第二个 | 点侧栏头像卡 → 連接另一個 Yuki |
| 把主动讯息改到 QQ 私聊 | 設定 → 連線 → 选下拉，立即生效 |
| 登出某个 Yuki 并保留本机资料 | 設定 → 連線 → 登出… → 撤銷 → 保留並登出 |
| 让 Yuki 使用这台电脑并开启完整访问 | 設定 → 這台電腦 → 連接 → 打开完整访问 |
| 接入本机 Codex | 設定 → 這台電腦 → 新增 Agent → 寻找 → 儲存 |
| 回应 Codex 的权限请求 | 侧栏 這台電腦 → 原生 Agent 任務 |
| 检查更新 | 設定 → 更新 |
| 分清"{名字} 的電腦"和"這台電腦" | 侧栏两项并列、图标不同 |

完成定义：
- `grep -rn "角色" src` = 0；
- 设置页任意尺寸只有一列分类导航，无主侧栏；
- 设置页内无裸按钮/裸 h3；每个分类刷新按钮 ≤ 1；
- 所有"未确认请求"使用 `PendingRequest` 且仍走原 UUID；
- 本文列出的 E2E 全部运行（skip 单独列明原因），新增 spec 的截图与 JSON 产物路径写进报告。
