# Yuki Desktop UI 重整实施与验证记录（2026-10-30）

实施依据：[UI 布局与设置重整任务书](Yuki-Desktop-UI布局与设置重整任务书-2026-10-30.md)。

各批记录中的“未推送／未创建 PR”是本地实施阶段的时点状态。用户随后明确授权全部提交 PR，最新远端与手动预览状态见文末。

## 基线与环境

- Desktop 基线：`79ee0359ba04bb6bb509142a086c52cf6f586ebb`，从已同步的 `origin/main` 建立独立 worktree `D:\Code\My_Github_Repo\Yuki-Desktop-ui-20261030`。
- 后端仅作测试与合同参考：干净 worktree `D:\Code\My_Github_Repo\Yuki-Desktop-ui-backend-20261030`，修订 `34167dd4c158478ef89f3ac7892ac9d51cfaafa0`；未修改后端源码。
- 实际 Desktop 与后端均为 API 7，任务书的 API 6 旧描述已更正；未修改 API 合同。
- Windows x64；独立安装 Desktop 依赖、Python 3.12 测试环境及 vec1 DLL。早期原生测试使用本轮构建的 `dist/win-unpacked/Yuki.exe`；用户要求测试窗口留在后台后，使用另行标识的 `dist/background-tests/win-unpacked/Yuki.exe`。后端和用户资料目录均独立。
- 通用命令：`npm run lint`、`npm run typecheck`。E2E 显式设置 `YUKI_BACKEND_TEST_ROOT`、`YUKI_BACKEND_TEST_PYTHON`；默认配置产物由 `YUKI_E2E_OUTPUT` 指定，原生配置产物由 `YUKI_NATIVE_TEST_OUTPUT` 指定。

## PR-1：术语清理

分支：`codex/ui-terms-20261030`。

按任务书清理用户可见的“角色”与“Bot”，保留 `characterId`、后端字段及测试资料。同步主进程菜单、部署提示、通知与头像文案，以及 macOS 麦克风权限说明。头像两个入口同名后，测试分别定位既有 header 和“頭像”区域。没有增加兼容入口、替代状态或单元测试。

- `npm run lint`、`npm run typecheck`、`git diff --check`：通过。`rg -n '角色' src`：无命中；renderer 剩余 `Bot` 为代码标识符及英文注释。
- 首批 `about-profile.spec.ts`、`avatar-short.spec.ts`、`renderer-regressions.spec.ts`：33 通过，头像短窗口用例因该批尚未传入后端环境而跳过，另批补跑。
- 后端批 `avatar.spec.ts`、`character-control.spec.ts`、`character-data.spec.ts`、`characters.spec.ts`、`computer-preview.spec.ts`、`computer-toolbar.spec.ts`、`computer.spec.ts`、`prompts.spec.ts`、`real-headed-computer.spec.ts`、`server-settings.spec.ts`、`settings.spec.ts`、`unconfigured-workspace.spec.ts`、`palette.spec.ts`：19 通过，1 跳过。
- `real-headed-computer.spec.ts` 跳过原因：未配置带真实 Xvnc/Chromium 的独立 `YUKI_DESKTOP_HEADED_BACKEND_URL`。Windows 默认 `grepInvert` 另排除两个 `computer.spec.ts` 和一个 `palette.spec.ts` 的 `@unix-manager` 用例；它们依赖 Unix socket，不记为本机通过。
- `avatar-short.spec.ts` 显式传入后端后补跑：1 通过，进程退出码 0；产物 `.cache/pr1-avatar-short/`。
- Windows 原生头像测试首次停在既有字符串断言：期望 `aria-valuenow="110"`，实际为 `110.00000000000001`。仅将测试改为数值 `toBeCloseTo(110)`，不改变缩放实现；全新后端重跑 1 通过，产物 `.cache/pr1-native-results-avatar-rerun/`，首次失败证据保留于 `.cache/pr1-native-results-avatar/`。
- Windows 原生资料测试首次在记忆来源跳转超时：通用回复文本已经存在于初始历史，测试没有等待本次提交入账，fixture 因而选到了旧事件。复用普通 `character-data.spec.ts` 的原 outbox 请求 ID、事件 ID 和 `waitForMainEnded` 回执路径，再核对 `seeded.source_event_id`。产品与后端不改；全新后端重跑 1 通过，产物 `.cache/pr1-native-results-data-rerun/`；首次失败证据保留于 `.cache/pr1-native-results-data/`。
- Windows 原生多个 Yuki 测试首次因宽屏侧栏旧断言 `position: static` 失败；源码与普通 `characters.spec.ts` 均为 `relative`，仅同步原生断言。全新两个后端重跑 1 通过，产物 `.cache/pr1-native-results-roles-rerun/`；首次失败证据保留于 `.cache/pr1-native-results-roles/`。
- 测试收尾时观察到 Vite 的 npm 包装子进程未退出；移除 `webServer.command` 的 npm 包装，直接运行现有 Vite CLI。`about-profile.spec.ts --grep 'an empty profile'` 验证 1 通过且进程正常退出（`.cache/pr1-vite-shutdown/`）。不增加重试或超时。
- 首批与后端批产物：`.cache/pr1-renderer/`、`.cache/pr1-backend/`。默认各批命令为 `npm exec playwright -- test <上述 spec 路径>`；三份原生 spec 使用 `npm exec playwright -- test --config playwright.shell.config.ts tests/e2e/<spec>`，均在本轮打包程序与独立后端上通过。
- PR-1 本地实现与上述验证完成，按该分支提交；未推送或创建远端 PR。

## PR-2：设置外壳与信息架构

分支：`codex/ui-settings-shell-20261030`，接续 PR-1 `1f560ea`。

删除嵌入式设置、工作区设置分支、旧布尔请求 props 和内部分类状态；App 持有唯一分类，设置全窗口显示，原会话保持挂载并停用。设置导航分应用、当前 Yuki、所有 Yuki／进阶；更新与新增入口集中到指定分类。新增 `SettingsSection`，复用原 Row、错误通道与菜单。

- 切换已连接 Yuki 时保留设置及分类；需要重新配对的连接继续原配对流程。现有未完成登出直接显示原 `LogoutFlow`，普通登出区待 PR-3 搬迁。
- 源码核对发现任务书将 inactive 录音写作“取消”，实际既有流程结束录音并保留待送语音草稿。保留产品行为并修正文档，不新增取消、保存或恢复机制，也不自动发送。
- `npm run lint`、`npm run typecheck`、构建：通过。重点批 `settings-layout.spec.ts`、`settings.spec.ts`、`unconfigured-workspace.spec.ts`、`voice.spec.ts`：9 通过，产物 `.cache/pr2-core/`。
- 录音验证使用模拟音源的真实 MediaRecorder，观察真实 start/stop 和实际上传的 ready 附件；账本事件 ID 前后一致，未自动发送。不将其写作物理麦克风验收。
- 截图复查发现分类高亮的弹簧动画尚未结束，已让新布局 spec 经真实外观设置开启“減少動態”，并等待高亮与所选分类几何位置对齐后拍图；不改产品动画，不增加固定 sleep。
- 初次整合批定位到全窗口设置的实际导航回归：QQ 只读入口打开设置后 `Ctrl+1` 仅切视图，未切回原桌面对话。改为调用既有 `workspace.navigate`，传原 `connection.characterId/conversationId`；不重建业务身份、不重发命令。首次失败 trace 保留于 `.cache/pr2-integration/chat-navigation-the-main-c-3438a-ut-losing-the-desktop-draft/`；原完整导航／SOUL 守卫用例定向重跑通过。
- 首次整合批 70 个用例结果：65 通过、2 跳过、3 失败。另两处按既定布局合同修正测试：未连接页面已经指定宽窗口，初始化断言直接等待默认主导航可见，删除可能在窗口初始 resize 间误切侧栏的操作；内联工作回答框在设置前后保持挂载与打开，直接核对同一回答框及草稿，删除旧嵌入模式下的重新打开操作。
- 更新通道的实际控件是 `radio`；打包更新测试中的两处旧 `tab/aria-selected` 断言同步为 `radio/aria-checked`，不改产品角色。
- 修复后定向批 8 用例：7 通过，部署配置用例在冷重启后的宽窗口假设处失败。本机表单、设置往返与草稿保留均已通过；冷窗口诊断采样 `724×564`、DPR `1.25`、`visible=false`，说明 `firstWindow()` 尚不代表窗口已显示或进入相同尺寸。冷重启后复用既有 `sizeWorkspace()`，等待原生显示并设置与前段相同的尺寸，单例补跑 1 通过。没有修改产品窗口恢复逻辑，也没有新增重试或超时。
- 定向批命令：`npm exec playwright -- test tests/e2e/chat-navigation.spec.ts tests/e2e/unconfigured-workspace.spec.ts tests/e2e/work-inputs.spec.ts tests/e2e/settings.spec.ts --grep 'main chat entry|unconfigured workspace|local Yuki|actual settings|settings categories|full-window settings|inline answers' --reporter=list`；产物 `.cache/pr2-fixed/`，原日志 `.cache/pr2-fixed.log`。冷启动补跑使用 `unconfigured-workspace.spec.ts --grep 'local Yuki configuration stays reachable'`，产物与诊断 `.cache/pr2-cold-stage/`。
- 长批测试收尾仍观察到 runner 的 Vite 进程未退出；本轮改为复用独立持有的测试 Vite（仅 `.cache/` 日志与 PID，任务结束关闭），不向产品加入回收、重试或超时机制。
- 整合批除上述三例外的 65 个用例通过，涵盖原请求回执、装置、登出、连接器、媒体与设置 fixture。重拍的三尺寸／九分类 27 张截图及 `settings-layout.json` 位于 `.cache/pr2-integration/settings-layout-settings-h-c9f73-across-actual-Yuki-switches/`；已人工查看小窗口的一般／连线截图，高亮与分类对齐，设置无主工作区侧栏。
- 最终 Windows 打包程序补跑 `windows-roles.spec.ts`：1 通过，产物 `.cache/pr2-native-roles/`。打包 Renderer 的 HTML 与主 JS 均和最终构建 SHA-256 一致，证据 `.cache/pr2-final-package-renderer.json`。
- `YUKI_DESKTOP_EXECUTABLE` 指向最终包，补跑默认开发模式跳过的两个更新用例：`npm exec playwright -- test tests/e2e/updates.spec.ts --grep 'actual update buttons|update controls cancel' --reporter=list`，2 通过、0 跳过。产物 `.cache/pr2-updates-packaged/`，使用现有 SDK 安装器替身，不执行真实安装。
- PR-2 本地实现、对应静态检查、整合及定向修复验证完成；最初失败和跳过均按上述记录补验，未重复未改的整批测试。原生测试的两个手动后端均已关闭并确认 exit 0，证据目录保留。

## PR-3：当前 Yuki 的连线与装置

分支：`codex/ui-settings-yuki-20261030`，接续 PR-2 `a8d69c5`。

- 连线页按服务器、主动讯息、资料、登出重排；技术资料折叠。主动目的地选中即提交选择时的 CAS revision；确定失败回滚选择器，未知结果沿原 UUID 查证。删除独立保存、正常刷新与旧刷新函数。
- 装置按真实用途分组；登出搬到连线页，三份确认 Sheet、prepare／finish 原流程保持。私有读取失权仍隐藏资料，保留本机登出收尾入口。
- 设置中三类待确认反馈使用 `PendingRequest`；发码 Sheet 底部仅“完成”，明确新建的“再產生一個”位于结果区域之后。沿已有错误／提示状态记录界面归属，不增加执行、授权或完成门槛。
- 更正任务书查证文案：现有回执查询查无时可能接续同一 UUID，写“不建立新请求”，不改变原执行合同。
- `npm run lint`、`npm run build`（含 typecheck）：通过。四份 spec 首批 `npm exec playwright -- test tests/e2e/server-settings.spec.ts tests/e2e/device-security.spec.ts tests/e2e/logout.spec.ts tests/e2e/settings-layout.spec.ts --reporter=list`：8 通过、3 失败，产物 `.cache/pr3-e2e/`。
- 两个失败停在新增的测试 visibility 辅助断言，本机 native hide 后仍报告 `visible`。已直接删除该门槛及 helper；装置用原 SSE，延迟读取用现有设置重开触发真实请求，不增加超时或重试。第三处为测试误写冲突码，按真实回执与现有映射更正为 `version_conflict`，保留旧 revision、回滚及写入次数断言。
- 三个失败用例定向 `--grep 'real QR pixels|logout drains|two actual devices keep proactive'` 重跑：3 通过，产物 `.cache/pr3-fixed/`、日志 `.cache/pr3-fixed.log`。没有放宽 CAS、写入计数或身份断言。
- 补充检查每个分类标题的实际几何与视口可见性，重跑 `settings-layout.spec.ts`：1 通过，27 张图及逐页 `*.layout.json` 位于 `.cache/pr3-heading-layout/`。已查看小窗口连线／装置页面；标题与分类高亮可见，连线技术资料折叠，装置按组呈现。记录实际 DPI 尺寸，不将请求尺寸当作实际窗口尺寸。
- 最新静态检查通过。PR-3 本地实现及对应验证完成，按该分支提交；未推送或创建远端 PR。

## PR-4：这台电脑的设置与活动

分支：`codex/ui-local-computer-20261030`，接续 PR-3 `75a0338`。

- 新增 `local` 视图、菜单与 Ctrl/Cmd+6 入口；未授权显示空态并直达设置。沿原查询键、SSE 和真实本人匹配读取状态，Conversation 复用已有失权提示。没有改 connector IPC 或新建全局状态。
- 设置保留唯一状态主动作、背景连接 Toggle、完整访问、旧安装沿用／更新和技术排障；Agent 编辑移入 Sheet。派生摘要区分未配对、未安装、已停止与未知，行内连接描述只在真实匹配时显示。
- 活动页分原生任务／终端两页，内容保持挂载；每页右上一个“重新整理”。保留原提交、分页、原 UUID、权限请求和停止逻辑。
- `npm run lint`、`npm run build`（含 typecheck）、`git diff --check`：通过。
- 首批 `agent-connector.spec.ts native-request.spec.ts native.spec.ts local-computer.spec.ts`：25 通过、3 失败，产物 `.cache/pr4-e2e/`、日志 `.cache/pr4-e2e.log`。`native.spec.ts` 的真实源程序／隔离 OS 适配器路径通过；没有宿主剪贴板或服务安装的额外验收声明。
- 三处失败分别是摘要与折叠技术信息同名造成 strict 定位重复、新增真实后端用例未配置同类测试的整体执行预算、测试把原生 options 回覆误写成 response.decision。定位收窄到状态 Section；真实用例使用既有同类后端测试的 120 秒总预算（不改变单步、产品超时或重试）；原生实际协议为 `agentTarget.option_id='accept'`，按合同更正断言。
- 真实后端空态／设置跳转补跑：1 通过（24.4 秒），产物 `.cache/pr4-real-empty/`。组件定向补跑：3 通过，产物 `.cache/pr4-fixed/`、日志 `.cache/pr4-fixed.log`。其中修正故障注入，实际覆盖“configure 已保存、随后启动失败”：Sheet／草稿／原实例 ID 保持，同 ID 保存后仍停止，再由明确 Toggle 启动；JSON 记录持久状态与调用。没有将普通成功编辑当作失败恢复验收。
- 三尺寸空态图与 `local-computer-empty.json` 位于 `.cache/pr4-real-empty/local-computer-a-real-pair-14bd6-ing-or-starting-a-connector/`；双 Tab／NativeRequest／分页及草稿图和 `local-computer.json` 位于 `.cache/pr4-fixed/local-computer-the-compone-bb261--across-local-activity-tabs/`。已查看小窗口空态和活动图。
- 证据分层：真实后端验证未批准本机连接时的路径；正向连接器、Agent、权限回覆与故障为真实组件配合明确 mock 的 E2E。未启动或授权宿主连接器服务，没有宣称真实宿主 Agent 握手或模型执行通过。
- 最终分支包含搬迁实现 `03f9075` 及恢复原设备组件 key 的 `43ba2a1`。设备切换补验在 PR-6 复核阶段执行并通过，交付前归回本批；同设备切 Tab 保留状态，不同真实设备重建原身份所属的局部组件。

## PR-5：侧栏与 Yuki 菜单

分支：`codex/ui-sidebar-20261030`，接续 PR-4 `43ba2a1`。

- 头像卡作为单个／多个／零连接菜单入口；PresenceCard 只渲染内容，名字和状态作为菜单描述。保留选中连接初焦点、Escape、外点和 inactive 行为；方向键遍历连接及新增／部署／关于动作。新增动作继续经过已有导航守卫。
- 侧栏明确按桌面对话、私聊入口、工作／档案／远端电脑／这台电脑排列，关于与设定位于底部；删除重复返回入口及旧 CSS。详情、放大／还原文案及两处浮层／焦点选择器同步，内部命令和身份不变。档案行的实际按钮同时保留完整文件名与双击提示。
- 最窄侧栏会裁切固定 240px 菜单，改为随卡宽收缩；设置菜单保留 240px。任务书示例同步实际布局事实，没有新增 portal、测量状态或定时器。
- `npm run lint`、`npm run build`（含 typecheck）、`git diff --check`：通过。组件批 `role-switcher.spec.ts components.spec.ts renderer-regressions.spec.ts`（CLI 名称匹配亦含 `work-components.spec.ts`）：35 通过、1 失败，产物从默认临时输出完整复制到 `.cache/pr5-components/`，日志 `.cache/pr5-components.log`。新增菜单描述测试发现头像 alt 与名字重复；将已有可见名字旁的头像标为装饰内容，保留真实名字与状态描述，整合批四项菜单用例全部通过。
- 后端整合命令：`npm exec playwright -- test role-switcher.spec.ts characters.spec.ts chat-navigation.spec.ts responsive-columns.spec.ts workspace-layout.spec.ts computer-preview.spec.ts palette.spec.ts unconfigured-workspace.spec.ts settings-layout.spec.ts --reporter=list`。原批 `.cache/pr5-integration/` 已完成 16 项通过；按用户要求停止会抢前台的窗口测试，最后 2 项中断，不计入通过。补跑这两项 `--grep 'late repair|only visible columns'`：2 通过，产物 `.cache/pr5-background-finish/`、日志 `.cache/pr5-background-finish.log`。原批和补批合计覆盖全部 18 个 Windows 可运行用例。
- Windows 配置另外排除三个 Unix manager 用例：`computer-preview.spec.ts` 1 项、`workspace-layout.spec.ts` 1 项、`palette.spec.ts` 1 项；未宣称这些用例通过。
- 6 张侧栏图、27 张设置图及含按钮顺序／分组／卡片名字状态的 `settings-layout.json` 位于 `.cache/pr5-integration/settings-layout-settings-h-c9f73-across-actual-Yuki-switches/`。已查看宽窗口单连接和窄窗口双连接截图，底部入口与两类电脑顺序正确。
- 用户新增要求：测试窗口留在其他窗口后面。仅在测试入口加入 Windows 后台 fixture，设置不可激活后一次异步按本进程 HWND／PID 显示到底层；不改产品窗口代码、不轮询、不伪造焦点状态。后续源程序测试设置 `YUKI_E2E_BACKGROUND_WINDOWS=1`；默认测试配置保留真实 OS 焦点用例原语义。原生入口无法直接使用源程序入口的 hook，后续使用单独明确标识的后台测试包。
- 后台启动实证 `.cache/pr5-background-proof/background-window.json`：窗口 visible=true、focused=false、focusable=false，显示前后前台 HWND 相同且均非测试 PID；测试配置变更后再验通过。需要 OS 真焦点的 responsive 用例已在用户提出此约束前通过，不会用后台替身重复宣称同一验收。

## PR-6：视图细节

分支：`codex/ui-views-20261030`，接续 PR-5 `529a968`。

- 删除 Conversation 不可达占位兜底，没有另加替代分支；引用删除改为保留可访问名的图标按钮。移除未连接页重复工具列设置按钮，侧栏设置仍可达。
- 档案预览先于完整信息卡，ID／版本／发布路径默认折叠；保存、复制、引用和比较仍在外部且走原版本。工作／档案删除重复列表标题，工作来源为全部／桌面／其他入口，原取消确认入口与状态同排，用量默认折叠。缩放按钮明确文字与 aria-pressed，不改变接手权限或缩放执行。
- 复核发现 PR-4 搬迁时漏了原 `characterId + deviceId` 组件 key，已恢复既有设备身份边界，原修复提交 `e7de882`，交付前归回 PR-4 为 `43ba2a1`。新增真实组件回归同时保留同设备切 Tab 的原 UUID／分页／草稿，证明换设备后旧回执、权限、会话与终端控制不会混入新目标；旧详情仍能按原 ID 读取，未靠拒绝旧读掩盖问题。
- `npm run lint`、`npm run build`（含 typecheck）、`git diff --check`：通过。首批 `artifacts.spec.ts work-components.spec.ts computer-toolbar.spec.ts unconfigured-workspace.spec.ts`：4 通过、2 失败，产物 `.cache/pr6-e2e/`。Windows 配置排除 `computer-toolbar.spec.ts` 的 1 项 Unix manager 用例，未宣称远端电脑接手／缩放原生流程在 Windows 通过。
- 两个失败为测试问题：冷重启后的 trace 停在切换型 sidebar helper，而目标是默认展开的宽窗口导航，删除切换操作并等待现有导航可见；新增用量定位在 has 中重复包含外层 complementary 祖先，改为真正相对的纯文本定位。没有增加超时、重试或修改产品行为。
- 定向补跑失效用例、用量组件及完整 `local-computer.spec.ts`：7 通过，产物 `.cache/pr6-fixed/`、日志 `.cache/pr6-fixed.log`。工作真实请求、原 Main／Work 回执、筛选、取消确认的保持执行、三尺寸同排／折叠及预算均验证，命令回执与原工作身份不变。另适配预算折叠影响的 renderer／native-work 既有断言，不删除原预算或焦点校验。
- 后台测试包：`.cache/package-background.ps1` 在最终构建后复制测试 hook 并生成启动入口，通过 `extraMetadata.main` 单独输出 `dist/background-tests/`；仓库 package.json、正式入口与业务模块不变。包内 202 个 out 文件逐一 SHA-256 与构建一致，证据 `.cache/pr6-painted-native-proof/background-package.json`；真实 packaged=true、encryptionAvailable=true，前台 HWND 未变化。后台入口不代表正式入口或 OS 前台焦点验收。
- 首次 `native-file-layout.spec.ts` 程序断言 1 通过，但人工查看为黑色 HWND 图，因此没有计作像素验收。后台测试 hook 改为不可见且鼠标穿透地调用 Electron showInactive 完成绘制，再按原 HWND 置底后恢复显示；前台不激活，业务窗口代码不改。清晰自有窗口图 `.cache/pr6-painted-native-proof/owned-hwnd.png`。
- 随后的原生截图遇到命令超时／取消。文件和工作纯截图明确选择 captureOnly，删除无关 UIA 整树枚举；保留默认 caption 校验路径。进一步日志明确定位 Windows CIM 查询取消 `0x80041032`，删除 CIM 依赖并复用既有 Diagnostics.Process 读取真实 exe 与会话；PID、HWND、同会话及物理 DPI 校验保持，没有兜底或重试。失败证据 `.cache/pr6-native-files-painted/`、`.cache/pr6-native-final/` 保留。
- 最终原生命令：`npm exec playwright -- test --config playwright.shell.config.ts native-file-layout.spec.ts native-work-layout.spec.ts --reporter=list`，`YUKI_ELECTRON_EXECUTABLE` 指向后台测试包。2 通过，产物 `.cache/pr6-native-process/`、日志 `.cache/pr6-native-process.log`；三尺寸／四外观的自有 HWND 实像、原文件版本、工作继续执行和原回执均保留。已人工查看深色档案和窄窗工作图，确认有完整界面像素；这些后台截图未代替前台 caption／拖放／系统文件对话框验收。
- 原成果截图与 `artifact-versions-and-layout.json` 位于 `.cache/pr6-e2e/artifacts-reads-real-deliv-a7815-nd-removes-revoked-previews/`；6 张工作用量图与 `original-work-view-layout.json` 位于 `.cache/pr6-fixed/work-components-the-actual-1215f-hed-to-the-original-receipt/`；设备切换 JSON 位于 `.cache/pr6-fixed/local-computer-a-changed-l-b95a7-or-terminal-control-request/`。PR-6 对应本地验证完成。

## PR-7：平台文案

分支：`codex/ui-platform-20261030`，接续 PR-6 `03fb1e4`。

- 设置的托盘标题和 Toggle 可访问名统一按实际 `boot.platform` 显示 macOS「選單列」或其他平台「系統匣」；发送键显示「⌘ Enter」或「Ctrl Enter」。Composer 显式接收已有 platform，沿 Conversation、WorkDetail、QuestionBox、WorkReply 传播，不新增查询、默认值或全局状态。提示文案匹配现有按键行为；命令面板的通用确认提示为 Enter。
- `npm run lint`、`npm run typecheck`、`npm run build`、`git diff --check`：通过。日志 `.cache/pr7-final-lint.log`、`.cache/pr7-final-typecheck.log`、`.cache/pr7-build.log`。`rg -n '角色' src` 无命中；renderer 的 ⌘／↩ 仅位于 Composer、Settings、SoulEditor 的平台分支。独立只读复核未发现 platform 漏传。
- renderer 定向验证 Composer 提交失败保留输入及 IME、命令面板 IME、工作列表／详情原步骤：3 通过，产物 `.cache/pr7-renderer/`、日志 `.cache/pr7-renderer.log`。
- 源程序命令 `npm exec playwright -- test tests/e2e/settings.spec.ts tests/e2e/native.spec.ts --reporter=list`：首批 2 通过、2 失败，产物 `.cache/pr7-source/`。两处失败均为测试定位：Row 的文本包含描述，改为匹配完整标题的子串（Toggle 仍精确匹配）；PR-6 已删除重复工作标题，改为等待真实「工作來源」tablist。原原生适配器用例和设置全尺寸用例已通过，失败两例定向补跑 2 通过，产物 `.cache/pr7-fixed/`、日志 `.cache/pr7-fixed.log`。没有修改产品行为、放宽身份断言或增加重试／超时。
- 实际 Windows boot 记录、托盘名、两类发送提示、持久设置及诊断计数位于 `.cache/pr7-fixed/settings-actual-settings-p-e2f03-d-private-diagnostic-export/settings-platform.json`。实际按 Enter 提交第一条，改设置后 Enter 保留换行、Ctrl+Enter 提交第二条；诊断仍仅统计导出时已接纳的一条，不包含消息原文。冷重启继续使用同一发送设置。全窗口设置往返继续保留同一草稿、阅读位置与布局，模拟音源 MediaRecorder 不自动发送。
- 最终构建打包到单独的后台测试目录，202 个 out 文件逐一核对 SHA-256。证据 `.cache/pr7-final-native-background-proof/background-package.json` 与 `owned-hwnd.png`：真实 packaged=true、加密可用；窗口 visible=true、focused=false、focusable=false，显示前后外部前台 HWND 相同。仅测试入口隔离默认协议注册和原生通知展示，不修改正式入口、业务模块或打包配置；这些系统适配器不计为协议注册、系统通知或前台焦点验收。
- 最终原生命令 `npm exec playwright -- test --config playwright.shell.config.ts tests/e2e/windows-client.spec.ts --reporter=list`，`YUKI_ELECTRON_EXECUTABLE` 指向上述后台包，连接本轮固定后端：1 通过（24.1 秒），产物 `.cache/pr7-native-client-final/`、日志 `.cache/pr7-native-client-final.log`。实际 packaged、sandbox、Windows 交互会话、DPAPI 凭据持久化、强杀原进程、同资料冷恢复、原 owner／request UUID／payload hash、原引用事件、唯一原消息及草稿仅提交一次均验证。先前同例 `.cache/pr7-native-client/` 亦通过，最终验收采用隔离系统副作用后的这一轮。
- 收尾发现早期原生启动将当前用户 yuki 协议和开始菜单快捷方式指向本 worktree 测试包。先保存本轮残留值与快捷方式，再以既有桌面快捷方式核实的已安装 Yuki 为目标恢复；仅在路径属于本 worktree 时写入。备份 `.cache/test-registrations-before.json`、`.cache/test-start-menu-before.lnk`，恢复结果 `.cache/test-registrations-after.json`。最终后台原生测试后复查 `.cache/pr7-final-host-registrations.json`，协议和开始菜单仍指向 `C:\Users\bymay\AppData\Local\Programs\Yuki\Yuki.exe`。这不代表恢复了任务开始前未采样的逐字注册内容；用户资料、聊天历史和已安装程序未改动。
- 本轮没有 macOS 实机或 Linux 原生窗口验收；组件 fixture 的 platform 为既有 Linux 上下文，实际发送与托盘路径为 Windows。未配置的 Xvnc／Unix manager 用例及正向宿主连接器边界见前述各批记录，不计为通过。

## 交付状态

七个批次均已完成本地实现及对应可运行验证，保留七条顺序依赖的本地分支。任务书要求的截图、JSON、失败记录和补验路径见各批；没有以新增业务兜底、重试、经验阈值、辅助完成状态或重建执行身份解决问题。恢复原设备 key 属于保留原身份边界。

| 批次 | 本地分支 | 实现提交末端 | 依赖 |
| --- | --- | --- | --- |
| PR-1 | `codex/ui-terms-20261030` | `1f560ea` | `79ee035` |
| PR-2 | `codex/ui-settings-shell-20261030` | `a8d69c5` | PR-1 |
| PR-3 | `codex/ui-settings-yuki-20261030` | `75a0338` | PR-2 |
| PR-4 | `codex/ui-local-computer-20261030` | `43ba2a1`（含 `03f9075`） | PR-3 |
| PR-5 | `codex/ui-sidebar-20261030` | `529a968` | PR-4 |
| PR-6 | `codex/ui-views-20261030` | `03fb1e4` | PR-5 |
| PR-7 | `codex/ui-platform-20261030` | `27d5299`（另含交付记录提交） | PR-6 |

整理前七个分支的提交保存于 `refs/codex/ui-taskbook-before-identity/*`，索引 `.cache/branches-before-identity.json`。归回身份修复并重排后，最终整棵受控文件树与已验证末端 `dd8d308` 完全一致（`git diff --exit-code refs/codex/ui-taskbook-before-identity/platform HEAD` 通过）；随后仅更新本记录的分支与交付说明，无产品或测试源码变动。

最后一个手动后端已通过其测试 shutdown 入口关闭并确认 exit 0；任务持有的 Vite PID／监听端口核实后已关闭，证据和 worktree 保留。

上述本地实施阶段未推送、未创建远端 PR。2026-10-30 用户随后明确授权全部提交 PR 并打开完整应用供手动测试，已完成以下交付。

## 远端 PR 与手动预览

七条分支以普通原子 push 上传，远端 PR 均为 open、非 draft，按前一分支为 base 保持每批差异；PR-1 指向 main。请按 1→7 审阅和合并，合并时同步后续 base，不将后六批提前并入 main。

| 批次 | GitHub PR |
| --- | --- |
| PR-1 | [#16：术语](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/16) |
| PR-2 | [#17：全窗口设置](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/17) |
| PR-3 | [#18：连线与装置](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/18) |
| PR-4 | [#19：这台电脑](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/19) |
| PR-5 | [#20：侧栏与菜单](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/20) |
| PR-6 | [#21：工作与档案详情](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/21) |
| PR-7 | [#22：平台文案](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/22) |

GitHub 连接器创建接口返回 403 后，使用本机已有登录的 gh 创建；逐条绑定到本 chat，再通过 GitHub API 核对 open、draft=false 和 base/head。没有合并、发布或安装；本地通过不代表 GitHub CI 全部通过，状态以各 PR checks 为准。

手动预览包 `dist/manual-preview/win-unpacked/Yuki.exe` 包含全部七批产品代码，基于 `7c31010` 的构建；与最终验收包的 202 个 out 文件逐一 SHA-256 一致，证据 `.cache/manual-preview-package-proof.json`。另设生成的手测入口，仅隔离宿主协议注册和原生通知展示，不加载自动化后台窗口 hook，窗口正常可交互。没有覆盖已安装的 Yuki。

使用独立 `.cache/manual-preview-profile/` 和 `.cache/manual-preview-backend/`，已通过真实配对界面连接本地参考后端并确认主界面“已連線”；窗口标题为 `Yuki UI Preview - 7 changes`。参考后端 API／资料／档案走真实代码，回复由脚本模型生成，不连接正式 Yuki，也未自动授权或启动宿主连接器。会话与进程信息保存在 `.cache/manual-preview-session.json`，本地后端与预览窗口为用户手动测试保持运行。已使用 computer-use 完成该测试实例的配对和主界面核对，随后停止 UI 输入。

## 手测反馈：连线页间距与本机 Agent 入口

- 用户指出「技術資訊」与「登出」紧贴。技术资讯 details 复用原有 `styles.section`，沿现有区块间距分开；只改一行样式引用，不增加容器、状态或执行条件。
- `npm run lint`、`npm run build`（含 typecheck）、`git diff --check` 通过。后台设置布局 E2E `npm exec playwright -- test tests/e2e/settings-layout.spec.ts --reporter=list`：1 通过（40.6 秒），产物 `.cache/feedback-connection-layout/`，日志 `.cache/feedback-connection-layout.log`。三尺寸连线图已生成，已人工查看宽窗口间距；未操作用户正在使用的预览窗口。本次样式修复随 PR #22 更新，已打开的 `7c31010` 预览包仍为之前构建。
- 本机 Agent 功能与原配置路径保留：设置 → 这台电脑 → 本机 Agent（可选），配置 Codex／Claude／ACP；活动在侧栏“这台电脑”→原生 Agent 任务／终端执行。设置区要求所选安装 available 且 paired；只发现旧安装但尚未选用、或未配对时不显示该区。活动另核对当前 Yuki 的真实接纳匹配。独立测试资料未替用户把原连接器改配给测试 Yuki，也没有进行宿主 Agent 执行验收；原生 Agent 独立授权不由通用完整访问开关决定。本次仅说明现有入口，没有放宽真实身份或授权检查。
