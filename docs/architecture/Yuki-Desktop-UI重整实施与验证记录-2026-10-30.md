# Yuki Desktop UI 重整实施与验证记录（2026-10-30）

实施依据：[UI 布局与设置重整任务书](Yuki-Desktop-UI布局与设置重整任务书-2026-10-30.md)。

## 基线与环境

- Desktop 基线：`79ee0359ba04bb6bb509142a086c52cf6f586ebb`，从已同步的 `origin/main` 建立独立 worktree `D:\Code\My_Github_Repo\Yuki-Desktop-ui-20261030`。
- 后端仅作测试与合同参考：干净 worktree `D:\Code\My_Github_Repo\Yuki-Desktop-ui-backend-20261030`，修订 `34167dd4c158478ef89f3ac7892ac9d51cfaafa0`；未修改后端源码。
- 实际 Desktop 与后端均为 API 7，任务书的 API 6 旧描述已更正；未修改 API 合同。
- Windows x64；独立安装 Desktop 依赖、Python 3.12 测试环境及 vec1 DLL。原生测试使用本轮构建的 `dist/win-unpacked/Yuki.exe` 与隔离的本地后端、用户资料目录。
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

当前仅本地实施与验证；未推送、未创建远端 PR、未合并、未发布或安装到用户环境。
