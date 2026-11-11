# Yuki Desktop 文本操作与链接修复任务书

日期：2026-11-11

状态：用户要求「按经典的工作流程去做，找bug，写任务书，执行，等ci，然后把我本机更新」，本任务书即执行依据。

## 1. 目标与原则

让桌面端的文字像普通 macOS / Windows 应用一样可选、可复制、可粘贴、可撤销，链接在任何显示 Yuki 文字的地方都能打开。

- 禁止防御性编程：用 Electron 自带的 `context-menu` 参数和菜单角色（undo / redo / cut / copy / paste / selectAll），不自己实现剪贴板、撤销栈或选区计算。
- 外部链接沿用现有确认对话框与 http/https 限制，不放宽也不新增门槛。
- 删除重复的链接/代码复制处理，集中到 Markdown 组件一处。

## 2. 调研基线与确认的问题

基线：Desktop `origin/main` = `9975207`；Backend `origin/main` = `42241301`（Desktop 契约钉住的提交）。

调研用真实 Electron + 真实后端探针（未提交）逐项复现。本机屏幕处于锁定状态，系统不允许任何应用成为前台，原生按键与剪贴板结果在锁屏下不可信，因此键盘快捷键只做静态核对，不作结论。

| 问题 | 证据 | 处理 |
| --- | --- | --- |
| 输入框右键没有任何菜单：没有剪下、复制、贴上、全选、复原 | 探针右键聊天输入框，`Menu.popup` 调用为零；主进程没有 `webContents.on('context-menu')`，只有消息和附件自己注册了右键 | 主进程统一处理 `context-menu`：可编辑处给编辑菜单（含拼写建议），有选区给复制，链接给开启/复制 |
| 消息以外的文字（工作详情、档案、设置、关于等）右键没有菜单，选中后无法右键复制 | 同上，只有 `Conversation.tsx`、`Media.tsx` 有 `onContextMenu` | 同上，由统一菜单覆盖 |
| 工作结果、Yuki 的提问以纯文本显示，里面的链接点不了，Markdown 不渲染 | `Works.tsx` 用 `<p>{result.text}</p>`、`<span>{question.text}</span>` | 改用现有 `Markdown` 组件 |
| 尚未确认送达的自己消息里，链接点了没反应，右键也没有菜单 | `Conversation.tsx` 链接处理带 `if (event)`；右键 `if (!event) return` | 链接处理移入 `Markdown`，不再依赖 event；未确认消息交给统一菜单 |
| 消息右键「複製連結文字」实际复制的是网址；没有「開啟連結」 | `app.ts` `context-menu` action 写入 `options.link`（href） | 改名「複製連結」，并加「開啟連結」（走同一确认流程） |
| 链接与代码复制的点击处理在 Conversation、Files 各写一份 | `Conversation.tsx`、`Files.tsx` 各自的 `onClick` | 合并到 `Markdown` 组件，删除两处重复 |
| 真实 ⌘C 的原生测试从未在 CI 运行 | `native-message-copy.spec.ts` 需 `YUKI_NATIVE_MESSAGE_COPY=1`，workflow 未设置 | 本轮不改（CI 机器的辅助功能权限另议）；记录在案 |

已确认正常、本轮不改：对话里已送达消息的链接左键点击（确认后打开）；Edit 菜单具备 undo/redo/cut/copy/paste/selectAll 角色与快捷键；输入框是原生 textarea，撤销栈未被受控组件破坏。

## 3. 施工项

### P1 统一右键菜单（主进程）

`win.webContents.on('context-menu', (_, params) => …)`：

- `params.isEditable`：拼写建议（`dictionarySuggestions` → `replaceMisspelling`）在前；之后「復原、重做、剪下、複製、貼上、全選」，按 `params.editFlags` 决定可用。
- 否则有 `params.selectionText`：「複製」。
- `params.linkURL` 为 http/https：追加「開啟連結」（与 `external` 同一确认流程）、「複製連結」。
- 三者都没有时不弹菜单。

渲染层已 `preventDefault` 的消息与附件右键保持各自菜单。

### P2 消息右键菜单

「複製連結文字」改为「複製連結」，有链接时加「開啟連結」。

### P3 Markdown 组件负责链接与代码复制

`RichMarkdown.tsx` 的 `Markdown` 接管 `a[href]` 点击（交给 `external`）和 `button[data-code-copy]`，错误通过 `onProblem` 交给调用方显示。删除 `Conversation.tsx`、`Files.tsx` 中的重复处理与 `if (event)` 门槛。

### P4 工作详情渲染 Markdown

工作结果、等待回答的问题改用 `Markdown`；工作目标仍是一行标题文字。

## 4. 失败情形（先写，再写代码）

E2E `tests/e2e/text-operations.spec.ts`，真实后端，后台窗口运行，产物 `text-operations.json`：

1. 右键聊天输入框没有菜单，或缺少「復原、重做、剪下、複製、貼上、全選」任一项。
2. 输入框有文字时，菜单「全選」+「剪下」后输入框没有清空；「貼上」后没有恢复原文字；再输入后「復原」没有撤回。
3. 输入框为空时「剪下 / 複製」仍可用。
4. 选中工作详情里的文字右键，没有「複製」。
5. 工作结果里的 Markdown 链接没有渲染成链接。
6. 左键点击工作结果里的链接，没有出现确认对话框，或确认后没有以原网址打开。
7. 右键工作结果里的链接，没有「開啟連結」「複製連結」；「開啟連結」没有走确认流程。
8. 右键消息里的链接，菜单仍是「複製連結文字」或缺少「開啟連結」。
9. 档案预览里的 Markdown 链接左键点击不再打开（P3 合并后回归）。
10. 非 http/https 链接（mailto）仍被拒绝并显示原有提示（不放宽）。

## 5. 验收与交付

- Desktop CI 全绿（lint、types、contracts、三平台 desktop 与 e2e、本机部署）。
- PR 合并后用本机签名身份「Yuki Local Signing」重新打包安装到 `~/Applications/Yuki.app`。
- 报告区分本地修改、验证、提交、推送、合并和本机更新。
