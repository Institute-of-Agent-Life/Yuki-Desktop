# 下一版 Yuki Desktop beta（待发布）

建议版本：**1.0.0-beta.9**。这是发布准备材料，尚未修改 `package.json` / lockfile 版本、打 tag 或创建 Release；当前公开下载仍为 [1.0.0-beta.8](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/releases/tag/desktop-v1.0.0-beta.8)。

2026-11-02 核对的源码范围为 beta.8 的实际提交 `e9ed2f59b6b86959c2cacbb953ed458645e9a159` 之后，到 main [`abbef6fa56c74319dbd103c98e697a619cc6b63b`](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/abbef6fa56c74319dbd103c98e697a619cc6b63b)：**24 个已合并 PR、88 个提交**。本次文档更新不递归计入。

## 主要变化

- **工作区和设置更清楚。** 统一 Yuki 术语、全窗口设置、分类导航、头像菜单及侧栏；这台电脑的连接设置和活动视图分开。工作/文件详情简化，托盘与发送快捷键按平台显示。
- **Tailscale 接入引导。** 引导在服务器卡片外独立展开。客户端和本机 Connector 分别改址，保留原设备身份和配对，不自动同步两端。Tailscale 仍由用户独立安装和登录。
- **管理员模型配置。** 使用当前 Person 超管资格读取和修改共享配置；连接、Provider、用途、Embedding、视觉、ASR 与搜索沿后端元数据编辑。支持模型发现、连接测试和原请求保存确认。非超管保留获准的个人功能，不因普通配对升权；实际连接测试可能产生供应商费用。
- **常用配置和用量减负。** 常用设置与进阶项分开，用量按时间窗口和实际供应商/模型呈现概览。缺失 token 不当成零，旧内部 Profile 名不冒充实际模型，也不凭空计算费用。
- **工作卡片重新排版。** 完成状态保持完整，标题与附件有独立空间；正文、交付和原工作详情沿实际结果呈现。
- **连接器随 Desktop 生命周期。** 随附 0.4.2/协议4；真正退出时停止，留在托盘时继续连接，不注册登录自启。Windows 隐藏原生代理控制台，并修复安装锁偏移；接管或升级原安装保留 device、instance、凭据与 journal。原生就绪与网络在线分别报告。

## 配套和升级

本截点固定后端 [`b86ee9b4890c75a620fd2810d8d7a97dafe4ae45`](https://github.com/YuanYeYouTao/Yuki/commit/b86ee9b4890c75a620fd2810d8d7a97dafe4ae45)，Client API revision **9**，详情见 [contracts/source.json](../../contracts/source.json)。安装桌面包不会升级远端 Bot；后端 4.0 的 schema0155、Person 超管、模型旧来源与插件适配见[后端升级指南](https://github.com/YuanYeYouTao/Yuki/blob/main/docs/upgrade-4.0.0.md)。

更新沿原 profile、Person、地址及设备资料处理，不重新配对或改原生登录。旧独立 Connector 仅在用户明确接管后移除其独立服务。普通 Desktop 管理的连接器与显式单独运行 CLI 的生命周期不同。

## 当前发布阻塞

以下是固定截点在 2026-11-02 读取的实际结果，后续修复需使用新提交的证据更新，不能把旧失败记成已通过。

| 验证 | 实际结果 |
| --- | --- |
| [完整六项 CI](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/actions/runs/41277506867) | 真实本地 Bot 部署成功，五个平台 Desktop job 失败 |
| 五平台共同失败 | `local-computer.spec.ts` 两例仍定位旧“背景連接”开关，而现行界面用“本機連接”；等待超时 |
| Windows x64 | 另有 `artifacts.spec.ts` 附件案例超时，根因未确认 |
| Linux ARM64 | 另有 `model-save-boundaries.spec.ts` 观察错误 `Resulting promise was garbage collected`，根因未确认 |
| 全平台发布包 | 当前失败 job 未继续完成打包上传，不能当作已验收安装资产 |

下一版 beta 有足够的用户可见变化。修复上述失败并完成相应构建后，再按 [RELEASING.md](../../RELEASING.md) 区分 unsigned beta、正式签章、公证、安装及旧版升级验收；现有 unsigned 产物不宣称完成正式签章。当前材料不足以直接宣布桌面 1.0 正式版。

## 全部 PR 与贡献者

完整分页读取已关闭 PR，按合并提交是否属于实际 Git 祖先差集筛选，未按 PR 编号或创建日期截断。24 项 PR 作者均为 [@YuanYeYouTao](https://github.com/YuanYeYouTao)；原始实现和协助验证沿各 PR 的原记录归属。日期为 UTC。

| PR | 作者 | 合并提交 | UTC |
| --- | --- | --- | --- |
| [#15 — 收拢测试：优先 E2E 产物，删除重复隔离用例](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/15) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [b0b4de6e](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/b0b4de6e325801251c27119a2c6cdfcb1927412d) | 2026-10-29T21:20:35Z |
| [#16 — [UI 1/7] 统一 Yuki 术语与用户文案](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/16) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [ee947ed7](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/ee947ed7703c77edf9d3cce405166c9281e99cc8) | 2026-10-30T15:57:44Z |
| [#17 — [UI 2/7] 统一全窗口设置与分类导航](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/17) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [77ef6909](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/77ef6909f2abd2122a2128ce2cb2367174c508ae) | 2026-10-30T15:58:31Z |
| [#18 — [UI 3/7] 重排连线与装置设置并即时提交主动入口](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/18) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [95a8efe4](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/95a8efe41ad6deb4fbeb14f7cffa008e318c7b7d) | 2026-10-30T15:58:42Z |
| [#19 — [UI 4/7] 拆分这台电脑的连接设置与活动视图](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/19) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [ed0fae26](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/ed0fae26aed11dfa02634f6f616f5f9e57447a70) | 2026-10-30T15:58:53Z |
| [#20 — [UI 5/7] 统一头像卡菜单与工作区侧栏导航](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/20) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [678c6526](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/678c65261c2bf5373ed90743b7644fcb3b9ce523) | 2026-10-30T15:59:05Z |
| [#21 — [UI 6/7] 简化工作与档案详情并明确缩放状态](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/21) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [85935c0b](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/85935c0b966723bfb21afb32be82b609b6022421) | 2026-10-30T15:59:16Z |
| [#22 — [UI 7/7] 按平台显示托盘与发送快捷键提示](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/22) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [4debd2ea](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/4debd2ea0810b284214114085709c57268f0f38c) | 2026-10-30T15:59:26Z |
| [#23 — 修复设置快捷键时序与跨平台 E2E 交互](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/23) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [edc6ac86](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/edc6ac86ef814fb29e0fe0b3dea15907456858de) | 2026-10-30T17:06:26Z |
| [#24 — 支持保留设备身份的独立改址与 Tailscale 接入引导](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/24) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [538fd53f](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/538fd53f5c8559eb97b903162dcdb27aa9c0da8a) | 2026-10-30T20:54:10Z |
| [#25 — test: 使用稳定入口查证已恢复的发码回执](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/25) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [057d6074](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/057d607419ebe6398e17130831e9a1e5d7c37bde) | 2026-10-30T21:51:01Z |
| [#26 — 将 Tailscale 连接说明移到服务器卡片外](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/26) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [e22d6960](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/e22d69605a8e6c23c63fef6f20c0b5570c340d68) | 2026-10-31T05:19:20Z |
| [#27 — fix: use Person administrator authority for shared Yuki settings](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/27) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [93fce554](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/93fce5541ce3ed4a6291f00dbca98f52f8328705) | 2026-10-31T15:02:10Z |
| [#28 — feat: expose typed model management through the existing bridge](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/28) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [7b539ef2](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/7b539ef201a8bcdea965f9d57e4bba499156fd3d) | 2026-10-31T16:08:25Z |
| [#29 — feat: add administrator model settings and bundle save flow](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/29) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [8ca8b6d1](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/8ca8b6d127a527b00d9162683c1c40537e9a8722) | 2026-10-31T16:08:34Z |
| [#30 — feat: edit model connections using provider metadata](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/30) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [73cc0924](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/73cc09247c970f3dcf71d99a44031306bd366f40) | 2026-10-31T16:08:42Z |
| [#31 — feat: test model connections and discover model IDs](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/31) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [d4d0f023](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/d4d0f023d83523dc676f68a06c6169685d1c3a3f) | 2026-10-31T16:08:51Z |
| [#32 — feat: configure model purposes and auxiliary connections](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/32) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [9f581579](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/9f581579fd8fa34ddbf9c62c42614bf120f52a0f) | 2026-10-31T16:12:56Z |
| [#33 — feat: show model usage and clear private data on authority changes](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/33) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [4ad6d903](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/4ad6d9036b994c43610162173297ac6f5940e18e) | 2026-10-31T16:13:07Z |
| [#34 — feat: reuse model connection setup for local deployment](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/34) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [524a9496](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/524a9496be48e3c805ecdd6afda6ead99566bf84) | 2026-10-31T16:13:16Z |
| [#35 — test: explicitly arrange the second work cancellation viewport](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/35) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [aa3956fa](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/aa3956fac9b7a84a1ca734d8538172a4344c3f6e) | 2026-10-31T17:09:10Z |
| [#36 — Simplify work cards and model settings, rebuild usage overview](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/36) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [cc7075f2](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/cc7075f296566130eb62f3bf19d1b036d497a1e1) | 2026-10-31T19:18:22Z |
| [#37 — Align model E2E checks with capability sets and window readiness](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/37) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [4066a854](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/4066a854642eac15a7aec80c5dff4dda3874c64c) | 2026-10-31T20:07:52Z |
| [#38 — fix(connector): follow Desktop lifetime without login autostart](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/pull/38) | [@YuanYeYouTao](https://github.com/YuanYeYouTao) | [abbef6fa](https://github.com/Institute-of-Agent-Life/Yuki-Desktop/commit/abbef6fa56c74319dbd103c98e697a619cc6b63b) | 2026-11-01T05:35:06Z |

