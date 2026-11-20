# Yuki Desktop 按钮长文字与回执刷新闪烁修复任务书

日期：2026-11-20

状态：用户在「这台电脑」的委派回执里看到按钮文字溢出按钮、操作行凌乱，且「很多地方都有」；同一弹窗里的「刷新原回执」一直闪、颜色一直变。经商量选定：按钮永不截断、不省略、不溢出，长文字在按钮内换行（居中、平衡，实际最多两行），按钮行换行而不互相挤压；按钮文字本身保持简短，说明放在周围文字里；后台重读不改变按钮的状态、颜色与布局，只有本人点的刷新显示按钮自己的 `loading`。基线为 `origin/main` 3adff8e。

## 1. 调研结论

| 事实 | 依据 | 处理 |
| --- | --- | --- |
| 按钮高度写死、文字不换行 | `Controls.module.css:7` `height: 28px`、`:14` `white-space: nowrap`、`:44` 大按钮 `height: 36px` | 改为 `min-height` 加上下内边距（单行时视觉仍为 28／36px），`text-align: center`、`text-wrap: balance`，文字可在按钮内换行 |
| 按钮被挤到比文字还窄，文字从两侧溢出 | `Controls.module.css:30` 主要／次要按钮 `min-width: 64px`：显式最小宽度取代了弹性项默认的「不小于内容」，在不换行的行里按钮可被压到 64px，而 `nowrap` 的文字照原宽度画出去。修改前实测：回执弹窗里「重新整理原回執」被压成 72px | 按钮 `flex-shrink: 0`（保持自身宽度，这正是 `nowrap` 下原本的效果）加 `max-width: 100%`（不宽过所在位置），只有一个按钮单独比所在位置还宽时才在按钮内换行；`min-width: 64px` 保留 |
| 弹窗按钮行不换行 | `Controls.module.css:174` `.dialogFooter` 无 `flex-wrap` | 加 `flex-wrap: wrap`，沿用原 8px 间距，放不下的按钮移到下一行、仍靠右 |
| 回执按钮文字过长 | 「排入原會話／調整進行中的回合／結束委派，保留原生任務／取消原生回合並結束委派／重新整理原回執／關閉」6 个按钮在 640px 弹窗里放不下（`ConnectorTasks.tsx:455–497`） | 文字缩成动词短语（见第 2 节），说明本来就在页首说明里（`connector:tasks.intro`） |
| 「重新整理原回執」闪烁变色 | `ConnectorTasks.tsx:492` `disabled={detail.isFetching}`；`tokens.css` 全局 `button:disabled { opacity: 0.4 }`。每次重读把按钮在可用／停用间来回切换，透明度 1↔0.4 | 不再按 `isFetching` 停用；本人点击的刷新用 `loading` 直到这次重读结束 |
| 「轮询」实为后台重读 | 全库没有 `refetchInterval`；`ConnectorTasks.tsx:105`、`ConnectorTerminals.tsx:45` 在服务器提示 `sync／refresh／work／conversation` 时使原操作与回执失效重读；委派是子 Work，串流对它只送 `refresh`，委派运行期间提示频繁；另有 `src.tsx:11` `refetchOnWindowFocus: true` | 重读本身不是问题，保留；只改按钮不跟随后台重读 |
| 同类：后台重读驱动按钮状态 | `ConnectorTasks.tsx:274`（页首重新整理）、`:439`（更多原操作）、`:552`（读取后续进度）；`ConnectorTerminals.tsx:104`（页首重新整理）、`:139`（更多终端任务）、`:154`（读取后续终端输出）、`:170`（重新整理原终端回执）；`ModelSettings.tsx:106` 冲突横幅「重新載入」`loading={bundle.isFetching}`，窗口重新取得焦点时也会转圈 | 刷新类按钮改用共用的 `useRefreshing()`（`Controls.tsx`）：点击后 `loading`，等这次的读取全部结束；「更多…」按钮改为 `loading={isFetchingNextPage}`（与「工作」「档案」的「更多」一致） |
| 回执内容是否闪成「正在讀取…」 | `ConnectorTasks.tsx:501`、`ConnectorTerminals.tsx:179`、`Delegations.tsx:517` 只在 `isPending`（尚无数据）时显示；失效重读保留原数据。修改前实测：后台重读期间内容一直在，未出现「正在讀取」 | 不改，作为失败情形 (d) 保留断言 |
| 其他按钮 | 全部视图的 `<Button>` 文字按三种语言统计长度；`Computer.tsx` 工具栏「交回給 {名字}」按名字截断属既有设计（名字是数据）；状态文字 `Computer.tsx:216`「確認中」、`ServerSettings.tsx:146`「檢查中」是说明正在检查的文字，不是按钮 | 只缩短确实冗长、周围已有说明的按钮文字；其余不动 |

## 2. 按钮文字（key 不变）

| key | 繁体 | 简体 | English |
| --- | --- | --- | --- |
| `connector:tasks.run` | 請 Yuki 委派給這個 Agent → 請 Yuki 委派 | 请 Yuki 委派给这个 Agent → 请 Yuki 委派 | Ask Yuki to Delegate to This Agent → Ask Yuki to Delegate |
| `connector:tasks.watch` | 請 Yuki 觀察此會話 → 請 Yuki 觀察 | 请 Yuki 观察此会话 → 请 Yuki 观察 | Ask Yuki to Watch This Session → Ask Yuki to Watch |
| `connector:tasks.steer` | 調整進行中的回合 → 調整回合 | 调整进行中的回合 → 调整回合 | Steer the Running Turn → Steer Turn |
| `connector:tasks.detach` | 結束委派，保留原生任務 → 結束委派 | 结束委派，保留原生任务 → 结束委派 | End Delegation, Keep the Native Task → End Delegation |
| `connector:tasks.cancel` | 取消原生回合並結束委派 → 取消回合 | 取消原生回合并结束委派 → 取消回合 | Cancel the Native Turn and End Delegation → Cancel Turn |
| `connector:tasks.cancelLegacy` | 請求取消原生執行 → 取消執行 | 请求取消原生执行 → 取消执行 | Request Cancel → Cancel Run |
| `connector:tasks.refreshReceipt` | 重新整理原回執 → 重新整理 | 刷新原回执 → 刷新 | Refresh Receipt → Refresh |
| `connector:tasks.moreProgress` | 讀取後續進度 → 更多進度 | 读取后续进度 → 更多进度 | Load More Progress → More Progress |
| `connector:terminals.moreOutput` | 讀取後續終端輸出 → 更多輸出 | 读取后续终端输出 → 更多输出 | Load More Output → More Output |
| `connector:terminals.stop` | 停止原終端執行 → 停止執行 | 停止原终端执行 → 停止执行 | Stop Run（不变） |
| `connector:terminals.resendStop` | 重送原停止請求 → 重送停止 | 重新发送原停止请求 → 重发停止 | Resend Stop Request → Resend Stop |
| `connector:terminals.verifyStop` | 查證原停止請求 → 查證停止 | 查证原停止请求 → 查证停止 | Verify Stop Request → Verify Stop |
| `connector:terminals.refreshReceipt` | 重新整理原終端回執 → 重新整理 | 刷新原终端回执 → 刷新 | Refresh Receipt → Refresh |
| `connector:native.submitAnswers` | 提交原問題回覆 → 提交回覆 | 提交原问题回复 → 提交回复 | Submit Answers（不变） |
| `works:moreActive` | 載入更多進行中工作 → 載入更多 | 加载更多进行中工作 → 加载更多 | Load More Active Work → Load More |
| `works:delegation.parent` | 查看發起這項委派的工作 → 查看上層工作 | 查看发起这项委派的工作 → 查看上层工作 | View the Work That Delegated This → View Parent Work |
| `ssh:forgetHost` | 忘記這台主機的舊指紋 → 忘記舊指紋 | 忘记这台主机的旧指纹 → 忘记旧指纹 | Forget Old Fingerprint（不变） |
| `about:keepAndClose` | 保留現有記憶並關閉 → 保留並關閉 | 保留现有记忆并关闭 → 保留并关闭 | Keep Memory and Close → Keep and Close |

回执弹窗是模态的，「重新整理」与页首同名按钮不会同时可操作；弹窗标题已说明是哪份回执。

## 3. 失败情形（先写，再写代码）

E2E：`tests/e2e/button-fit.spec.ts`（新），经 renderer fixture（`delegations.html`、`components.html`）驱动真实视图；三种语言 × 1440×900（常用）、960×640（窗口最小值）、600×720（低于最小值，检验窄弹窗）。

| # | 失败情形 | 修改前 | 修改后 |
| --- | --- | --- | --- |
| a | 可见的带文字按钮（共用 Button、分页、分段）`scrollWidth/scrollHeight` 超出自身，文字框超出按钮框，或文字超过两行；范围：「这台电脑」原生任务（含本机委派）、终端、连接器设置，原回执与终端回执弹窗（含 Client API 13 旧版回执），「工作」的委派视图 | 343 条（回执弹窗每种语言、每种尺寸都有） | 0 |
| b | 两个按钮重叠，按钮超出所在弹窗、设置行或窗口，或被横向裁切的祖先切掉 | 英文回执弹窗「Queue in Session」「Steer the Running Turn」被挤出弹窗左缘 | 0 |
| c | 串流 `refresh` 提示在后台重读回执（每次 800ms），无人点击时，页面或回执里任一按钮的 disabled、aria-busy、class、颜色、透明度或尺寸改变 | 页首「重新整理」与「重新整理原回執」各切换 6 次（3 次提示），透明度 1↔0.4 | 每个按钮只有一个状态 |
| d | 后台重读期间回执内容消失或出现「正在讀取…」 | 未出现 | 未出现 |
| e | 本人点击刷新：读取进行中没有 `aria-busy` 与转圈，或读取结束后仍在 loading | 点击后按钮只是变灰，从不显示 loading | 点击即 `aria-busy`，300ms 后转圈，读取结束（约 800ms）后恢复 |

## 4. 验证

- `npm run typecheck`、`npm run lint`、`npx prettier --check` 通过。
- `npx playwright test tests/e2e/button-fit.spec.ts`：修改前 2 项失败（证据保留在 `$TMPDIR/yuki-desktop-e2e-button-fit-before`），修改后 2 项通过（`$TMPDIR/yuki-desktop-e2e-button-fit-after`）：每个视图 × 语言 × 尺寸一张截图、`button-fit.json`、`background-receipt.json`／`background-terminal.json`、`clicked-receipt.json`／`clicked-terminal.json`。
- 受影响的既有用例（按钮文字定位已随文字更新）：`delegations`、`agent-connector`、`local-computer`、`components`、`native-request`、`control-motion`、`popup-polish`、`renderer-regressions`、`work-help`、`work-late-receipt`、`declutter`（需真后端的案例未设定时跳过）。
- 全部主页面三语排版（`language-layout.spec.ts`）以固定提交的隔离后端执行，量测按钮、分页、分段是否撑破或超出所在行、对话框、侧栏。

## 5. CI 首轮（PR #91，run 44782566096）

| 失败 | 根因 | 处理 |
| --- | --- | --- |
| `pairing-visual.spec.ts`（mac 与 Windows） | 高度由 `height` 改为 `min-height` 后，按钮成了「高度自动」的弹性项，被所在行拉伸：配对页 `.codeRow` 里「貼上」跟着 36px 输入框变成 36px（用例要求 28px，等待至超时）。凡是按钮与更高控件同行而未设 `align-items` 的地方都会如此 | 按钮加 `height: fit-content`：高度随文字（单行 28／36px，两行自然增高），不再被同行拉伸；列方向的宽度拉伸不受影响 |
| `button-fit.spec.ts`（Linux） | Linux 字体更宽，「工作」详情栏 600px 宽时状态行（状态胶囊＋「Cancel Delegation」）放不下；该行 `Works.module.css .status` 不换行 | `.status` 加 `flex-wrap: wrap`，按钮移到状态下方 |
| `about-profile.spec.ts` 前两项（Windows） | 分片第一个文件的前两项页面 30 秒保持空白：151 个模块全部 200、无报错，React 已启动；同一 fixture 的后续 5 项在同一分片通过，mac 本机全部通过；改动不涉及该页渲染路径 | 判断为冷启动偶发，重跑核对 |
| `glass-slices.spec.ts:131`（Windows） | 与本改动无关：只改合同的 `chore/connector-0.9.2`（run 44759757207）和更早的 run 43711634454 都以同样方式失败（对话框贴图次数 141） | 不改 |

## 6. 未包含

- 不改重读频率与串流提示；不改 Works 列表行（整行是按钮，标题按设计省略）。
- 只在 renderer fixture 与 Chromium 中量测；未在打包 App、Windows 原生窗口或系统字体缩放下逐一验收。
