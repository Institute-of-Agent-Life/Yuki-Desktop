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

当前仅本地实施与验证；未推送、未创建远端 PR、未合并、未发布或安装到用户环境。
