# Yuki Desktop 液态玻璃组件统一任务书

日期：2026-11-12

状态：用户要求「既然已经决定用液态玻璃风格，那最好把所有组件的风格都统一一下……看看怎么做最像，当前我的项目已经有不错的算法实现了……盘点一下需要修改的地方……注意一下延迟与开销，一定不能太大，需要极致优化」，并追加「消息多了会卡顿，看看渲染有没有可优化的地方」。第 7 节三问已定：Q1 气泡与工作卡片改磨砂（L2）、Q2 次要按钮做静光玻璃（L1）、Q3 工具列单独按钮放进透镜胶囊。基线为《全局透明磨砂与统一顶部淡出》（#67）。

测量环境（下文数字均出自此环境，脚本为一次性脚本，未进仓库）：Apple M6 宿主；Playwright 1.64.1 自带 Chromium 156（headless shell，默认 SwiftShader 软件渲染，与 CI 的 macOS 无显卡机同类）；另以 `--use-angle=metal` 跑 Metal 对照；DPR 2，视口 1280×820；页面为 `http://127.0.0.1:4178` 组件展示页与回归页（读的是当前工作区源码）。

## 1. 结论

### 1.1 现状事实

| 事实 | 依据 | 处理 |
| --- | --- | --- |
| 已有一套完整的折射材质：`useGlass(kind)` 为每块玻璃生成位移图（`feImage`+`feDisplacementMap`，浮动透镜另加红绿蓝三次位移色散）与光照图；光照图作 `[data-glass]::after` 的遮罩，光源是跟随指针的固定径向渐变 | `materials/glass.ts:6-16`（8 种 preset）、`:27-135`（`lens`）、`:167-366`；`materials/materials.css:25-45` | 作为唯一材质保留；本任务只改它的「生成方式」和「谁用它」，不新增第二套 |
| 正在用折射的玻璃共 11 处：工具按钮组、输入框、只读提示条、对话框、命令面板、角色菜单、配对/本机 Bot 欢迎卡片、电脑画面浮动工具列、开关/分段/滑杆滑块、对话气泡、工作卡片 | `Workspace.tsx:70,385`；`Composer.tsx:33`；`Conversation.tsx:182,1466`；`Controls.tsx:225`；`CommandPalette.tsx:85`；`RoleSwitcher.tsx:31`；`Pairing.tsx:43`；`LocalBot.tsx:20`；`Computer.tsx:437`；`InteractiveControls.tsx:18,112,293`；`ConversationGlass.tsx:5` | 见第 2 节逐项归层 |
| 同是玻璃，`backdrop-filter` 写了 7 种互不相同的串，顺序也不一：对话框/命令面板/角色菜单/欢迎卡片是「先模糊 24–28px 再折射」，工具组/输入框/只读条是「先折射再模糊」，电脑工具列自带一套 `contrast(0.84) brightness(0.88)`，滑块是 `blur(1–1.5px)`+折射 | `Controls.module.css:149`；`CommandPalette.module.css:12`；`RoleSwitcher.module.css:42`；`App.module.css:31,225,301`；`Computer.module.css:81`；`InteractiveControls.module.css:47,79,119`；`ConversationGlass.module.css:36` | 收敛为第 3 节的层级令牌，每层一串，顺序一致 |
| 静止的开关、分段、滑杆滑块也挂着折射：`--glass-pressure: 0`、位移 `scale=0`、底色不透明白，看不出折射，但 `backdrop-filter` 仍含 `url(#yuki-glass-n)`，每个控件一份 SVG 滤镜 | 组件展示页实测三种滑块静止时 `backdrop-filter: blur(1.5px) url("#yuki-glass-2")`、`background: rgb(255,255,255)`；`InteractiveControls.module.css:41-47,78-79,118-119` | 苹果：「静止状态保持安静，触碰时才升起为液态玻璃」。改为只在按住/拖动时折射 |
| 按住开关会连续重算贴图：滑块宽度 18→24px 逐像素变化，每个整数宽度生成一组位移图+光照图 | 实测按住 500ms 生成 10 张（`toDataURL` 计数）；`InteractiveControls.tsx:31`（逐帧改 `width`）、`glass.ts:320-329`（尺寸变就重算） | 交互期间不重算：用静止尺寸的贴图拉伸（`feImage` 已是 `preserveAspectRatio="none"`） |
| 贴图按「精确尺寸」缓存（LRU 16），大面板生成很贵，主线程同步执行。光照图按显示像素生成，DPR 2 时 480×788 对话框是 960×1576 的画布 | 表 1.3；`glass.ts:36-37,114,132` | 圆角矩形的位移图与光照图沿直边恒定，可「九宫格」：按（种类, 圆角, DPR）缓存一张小切片，任意尺寸复用 |
| 打开对话框在 CPU 6 倍降速下出现 97–165ms 长任务（现有《液态玻璃》第 8 条只在不降速下验 100ms，CI 曾超到 115ms） | 实测 `開啟對話框`：x1 无长任务；x6 长任务 [97,131]、[123,51,165] | 贴图改切片后单独计时，见第 4 节 |
| 窗口缩放时输入框、工具组每变一次宽度都整张重算贴图 | 输入框 712×84 单次 9.8ms（x6 55.9ms）；`glass.ts:320` | 切片后只剩一次画布拼接 + 编码 |
| 软件渲染下，对话列表里会滚动的气泡折射是滚动掉帧的主因 | `conversation-scroll` 程序滚动 240 帧：现状平均 27.6ms、152 帧 >20ms；只去掉气泡的 `url()`（保留 `blur(1px)`）16.7ms、0 帧；完全去掉气泡滤镜 16.7ms；Metal 下三者都是 16.7ms | 气泡属内容层，见问题 Q1 |
| 小块折射元素的并发上限：在滚动内容上叠 40×24 的折射块，Metal 下 +24 块无掉帧，+32 块平均 19.0ms（33 帧 >20ms），+40 块 24.1ms；同样 40 块只模糊或只用 CSS 描光，Metal 与软件都与不加相同 | 软件：每块折射约 +0.4–0.6ms/帧（+12 → 32.2ms，+40 → 50.4ms）；只模糊 40 块 26.4–30.0ms ≈ 基线 27.6ms | 小控件不要各自折射；同屏折射数设上限 |
| 指针光写在根元素：`--pointer-x/y` 未注册、可继承，每次指针移动整棵树重算样式 | 715 节点对话页每次 1.11ms（x6 8.84ms）；放大到 2769 节点 2.81ms；`glass.ts:140-164` | 改为只写在当前发光的玻璃上（注册为不继承，`::after` 显式 `inherit`）；同条件下写到 128 块玻璃上为 1.29ms，只写在场的十余块按比例约 0.15ms（推算） |
| `#yuki-backdrop-seal`（`feFuncA` 斜率 8）补的是 Chromium 的真实行为：`backdrop-filter` 结果叠在原背景之上，底下半透明时清晰内容会透出来 | 协调方在真实 Electron 透明窗口截图确认，浏览器夹具无法复现；本调研测得其成本可忽略：40 块「模糊+seal」Metal 16.7ms、软件 27.4ms（对照只模糊 26.4ms）；24 块「折射+seal」与「折射」相同 | 作为每个层级滤镜串的固定结尾 `var(--seal,)` |
| （更正）曾以为可滚动容器里的 `backdrop-filter` 在真实 Electron 窗口中无效，依据只是侧栏里的角色菜单。第 5 步真实窗口核对推翻：只声明可滚动的对话内容区、侧栏、正在滚动的设定页里的模糊探针都有效 | `native-glass.spec.ts`（屏幕截图，开关滤镜对比）；菜单的确切失效条件以相同结构的探针复现不出 | 角色菜单留在顶层；其余玻璃不必移出滚动区 |
| 对话框形变（`emerge`）期间不生成贴图，形变一结束折射突然出现 | `glass.ts:298-310` | 苹果：玻璃「通过逐渐调制光的弯折与透镜效果显现」。形变结束后折射强度由 0 升到 1 |
| 三个令牌已无人使用 | `--mat-thick`、`--mat-hud`、`--blur-chrome` 全仓引用 0 次（`tokens.css`） | 删除 |
| 全局磨砂下仍有大量不透明小面：输入框/下拉框用 `--bg-elevated` 白底，横幅是 `color-mix(状态色 12%, --bg-content)` 实色，悬浮操作条、新消息胶囊、代码复制钮、菜单错误气泡、SOUL 提示气泡是实色加 `--shadow-sheet/popover` | 第 2 节各行 | 内容层统一用半透明填充；浮在内容上的小件改为磨砂或透镜 |
| 两处手写的分段控件，未用 `Segmented` | `ModelUsage.module.css:23`（`.ranges`）、`:132`（`.groupTabs` 下划线页签） | 改用 `Segmented`，删除自写样式 |

### 1.2 与苹果液态玻璃逐项对照

依据：WWDC25 #219「Meet Liquid Glass」（[会话页](https://developer.apple.com/videos/play/wwdc2025/219/)）与 HIG Materials。

| 苹果的做法 | 本项目现状 | 处理 |
| --- | --- | --- |
| 透镜是主要特征：实时弯折、汇聚光线；面越大透镜越明显 | 位移集中在边框带（凸面轮廓），大面 bend 更大 | 保留 |
| 光源照在材质上，高光随几何形状变化，并随交互移动 | 方向光照图（左上亮、对角半亮、两侧暗）+ 指针径向光 | 保留，只改指针变量的写法 |
| 交互时「弯曲并被光点亮」，光从内部扩散 | `usePress` 鼓起、牵引，`[data-press]::after` 按压高光 | 保留 |
| 控件静止时安静，触碰时才「升起为玻璃」 | 滑块静止时就挂折射 | 改为按住时才折射（第 3 节 L1→L3） |
| 状态之间形变；弹出层从按钮「冒出」 | `motion/emerge.ts` 从按钮长出、缩回 | 保留 |
| 物化：以逐渐调制弯折强度显现，而非淡入 | 形变后折射突然出现 | 补渐入 |
| Regular（自适应、最常用）与 Clear（更透明、需要变暗层、只用于媒体之上）两种，「绝不混用」 | 电脑画面工具列（深色 50% 底 + 压暗）实际就是 Clear + 变暗层；其余接近 Regular，但滤镜串各写各的 | 层级令牌明确为「面板透镜/浮动透镜」两种 Regular 与一种 Clear |
| 着色只用于主要操作 | 主要按钮与发送按钮的有色玻璃 | 保留，不扩展到其他按钮 |
| 避免玻璃叠玻璃；玻璃上的元素用填充、透明度、鲜明度做薄层 | 工具组里的图标钮、菜单行、命令面板行都是填充（符合）；但对话框里的分段/开关静止时也挂折射（违反） | 静止控件不折射后自然符合 |
| 玻璃只用于浮在内容上的导航/控件层，不用于内容（列表、卡片） | 对话气泡、工作卡片在滚动列表里折射 | 问题 Q1 |
| 滚动边缘效果：软边逐渐溶解；固定表头用硬边 | `EdgeFade`（进行中）；档案预览头是实底加分隔线（`Files.module.css:53`），等同硬边 | 保留 |
| 阴影随背后内容调整；小件随背景明暗翻转 | 固定阴影、按主题定明暗 | 不做：网页读不到背后像素（《液态玻璃统一》已定） |
| 无障碍：减少透明更磨砂、增强对比黑白加描边、减少动态去弹性 | `data-opaque`、`data-contrast`、`data-motion` 三条路径 | 保留；每个层级逐项核对 |
| 色散 | 只给浮动透镜（输入框、工具组） | 保留 |

不做：形状融合（相邻玻璃合并成一块需要逐帧重算联合形状的贴图，开销与收益不成比例；工具组本身已是一个容器）、设备运动光照、按背景像素自适应。

## 2. 盘点

### 2.1 逐组件归层

层级定义见第 3 节：L0 内容、L1 静光、L2 磨砂、L3 透镜（面板/浮动/清透）、L4 有色。「滚动内」指最近的祖先是 `overflow: auto/scroll`（真实窗口里该处 `backdrop-filter` 可能失效，见 2.2）。

| 组件 | 位置 | 现状 | 归层 | 处理 | 折射 |
| --- | --- | --- | --- | --- | --- |
| 工具按钮组 | `App.module.css:213`；`Workspace.tsx:385` | 透镜 `toolbar`，先折射再 `blur(6px) saturate(180%)` | L3 浮动 | 改用层级令牌 | 是（含色散） |
| 工具列单独按钮（側邊欄、更多命令、更新） | `Workspace.tsx:370,402-403`；`ApplicationMenu.tsx:37` | 透明底图标，滚动后靠顶部淡出托底 | L3 浮动 | 问题 Q3：各自放进透镜胶囊（如 macOS 26） | 是（每个 +1） |
| 输入框 | `App.module.css:283`；`Composer.tsx:33` | 透镜 `composer`，16%/24% 本色 | L3 浮动 | 改用令牌 | 是（含色散） |
| 只读提示条 | `Conversation.module.css:425`；`Conversation.tsx:182` | 同输入框写法 | L3 浮动 | 改用令牌 | 是（含色散） |
| 新消息胶囊 | `Conversation.module.css:282`；`Conversation.tsx:1386` | `--bg-content` 实底 + `--shadow-sheet` | L3 浮动 | 改为浮动透镜，只在显示时存在 | 是 |
| 对话顶部浮动通知（横幅） | `Conversation.module.css:418`；`Conversation.tsx:1221` | `Banner` 实色（状态色混 `--bg-content`） | L2 | 磨砂 + 状态色薄着色 | 否 |
| 消息悬浮操作条 | `Conversation.module.css:132`；`Conversation.tsx:1727` | 实底 + `--shadow-sheet`；不悬停时 `opacity: 0` 但一直在 | L2 | 磨砂；只在 `:hover/:focus-within` 时挂滤镜 | 否 |
| 代码块复制钮 | `Conversation.module.css:164` | `--bg-content` 实底 | L0 | 气泡里（玻璃上）只用填充 | 否 |
| 对话气泡 | `Conversation.module.css:60`；`ConversationGlass.module.css:36` | 透镜 `bubble`，滚动内 | L3 或 L2 | 问题 Q1 | 视 Q1 |
| 工作卡片（聊天内） | `Content.module.css:1`；`Content.tsx:31` | 透镜 `card`（work-card），滚动内 | 同气泡 | 问题 Q1 | 视 Q1 |
| 对话框 `Sheet` | `Controls.module.css:141`；`Controls.tsx:225` | 透镜 `sheet`，先模糊 24px 再折射；顶层（`showModal`） | L3 面板 | 改用令牌；物化渐入 | 是 |
| 命令面板 | `CommandPalette.module.css:1`；`CommandPalette.tsx:85` | 同对话框；顶层 | L3 面板 | 同上 | 是 |
| 角色切换菜单 | `RoleSwitcher.module.css:33`；`RoleSwitcher.tsx:31` | 透镜 `card`，绝对定位在侧栏 `nav`（滚动内），真实窗口无效果 | L3 面板 | 协调方正迁到顶层 popover；改用令牌 | 是 |
| 配对/本机 Bot 欢迎卡片 | `App.module.css:23`；`Pairing.tsx:43`；`LocalBot.tsx:20` | 透镜 `card`，在 `.welcome`（`overflow: auto`）内 | L3 面板 | 改用令牌；真实窗口核实（2.2） | 是 |
| 电脑画面浮动工具列 | `Computer.module.css:67,241`；`Computer.tsx:437` | 透镜 `toolbar`，深色 50% 底 + 自带压暗 | L3 清透 | Clear 令牌（变暗层即底色） | 是（含色散） |
| 电脑画面问题提示 | `Computer.module.css:153` | `#3b2222e8` 实底，浮在画面上 | L2 | 清透磨砂 + 失败色薄着色 | 否 |
| 开关滑块 | `InteractiveControls.module.css:71`；`.tsx:18` | 静止也折射；按住重算贴图 | 静止 L1，按住 L3 | 见 1.1 | 仅按住时 |
| 分段滑块 | `InteractiveControls.module.css:34`；`.tsx:112` | 同上 | 静止 L1，按住 L3 | 同上 | 仅按住时 |
| 滑杆滑块 | `InteractiveControls.module.css:110`；`.tsx:293` | 同上 | 静止 L1，按住 L3 | 同上 | 仅按住时 |
| 分段轨道、开关轨道、滑杆轨道 | `InteractiveControls.module.css:1,49,92` | 填充 + 细线 | L0 | 保留 | 否 |
| 选中胶囊（侧栏、设定分类） | `InteractiveControls.module.css:140`；`Workspace.tsx:357`；`Settings.tsx:210` | `--fill-selected` | L0 | 保留（玻璃上的选中用填充） | 否 |
| 主要按钮、发送按钮 | `Controls.module.css:17,225,244-279` | 平涂有色 + CSS 方向边光 + 指针光 | L4 | 保留；指针光改写法后仍需亮 | 否 |
| 次要按钮 | `Controls.module.css:32` | `--fill-control` + 内描边 | L1 或 L0 | 问题 Q2 | 否 |
| 文字按钮、图标按钮 | `Controls.module.css:36,50` | 透明，悬停填充 | L0 | 保留 | 否 |
| 文字框 `TextField` | `Controls.module.css:61` | `--bg-elevated` 实白 + 粗描边，圆角 8 | L0 | 统一为半透明填充 + 细线，圆角 8 | 否 |
| 设定 `.row select` | `Settings.module.css:188` | `--bg-elevated` 实白，圆角 6 | L0 | 同文字框 | 否 |
| 模型表单下拉、字段组 | `ModelSettings.module.css:97,128` | 实白，圆角 6/8 | L0 | 同文字框 | 否 |
| 工作行内输入 | `Works.module.css:160` | 实白，圆角 6 | L0 | 同文字框 | 否 |
| 电脑备注 | `Computer.module.css:143` | 实白，圆角 8 | L0 | 同文字框 | 否 |
| 关于页编辑框、颜色框 | `About.module.css:161,181` | `--bg-content` 实底圆角 6；颜色框圆角 4 | L0 | 同文字框 | 否 |
| SOUL 编辑器搜索框/按钮 | `SoulEditor.module.css:131` | `--bg-content` 实底 | L0 | 同文字框 | 否 |
| 设定分组卡 | `Settings.module.css:134` | `--bg-raised` + 细线，圆角 12 | L0 | 定为卡片基准 | 否 |
| 模型卡 | `ModelSettings.module.css:25` | 同设定分组 | L0 | 同基准 | 否 |
| 工作成果、提问、回复头 | `Works.module.css:109,126,204` | `--bg-raised` / `--accent-subtle`，圆角 10/12 | L0 | 同基准（圆角 12） | 否 |
| 档案信息卡 | `Files.module.css:83` | `--surface-page` + 细线 | L0 | 同基准 | 否 |
| 关于页原文、待定 | `About.module.css:189,230` | `--bg-inspector` 实底，圆角 8 | L0 | 同基准 | 否 |
| 头像状态卡 | `AvatarStatus.module.css:1` | `--bg-inspector` 实底 | L0 | 同基准 | 否 |
| 头像编辑预览卡 | `AvatarEditor.module.css:104` | `--bg-sidebar` 实底 | L0 | 同基准 | 否 |
| 终端输出、代码 | `Settings.module.css:268`；`TailscaleGuide.module.css:36` | `--bg-raised` / `--fill-code` | L0 | 保留 | 否 |
| 横幅（内容内） | `Controls.module.css:130` | 状态色混 `--bg-content`，实色 | L0 | 改为状态色混透明，磨砂下不再是实色条 | 否 |
| 状态胶囊 | `Controls.module.css:109` | 状态色 12% | L0 | 保留（徽章不是玻璃） | 否 |
| 用量时间范围、分组页签 | `ModelUsage.module.css:23,132` | 手写分段 / 下划线页签 | L0 + 滑块 | 改用 `Segmented` | 仅按住时 |
| 菜单错误气泡 | `ApplicationMenu.module.css:19` | 实白 + `--shadow-popover` | L2 | 磨砂 | 否 |
| SOUL 提示气泡 | `SoulEditor.module.css:168` | 实白 + `--shadow-popover` | L2 | 磨砂 | 否 |
| 关于页头像编辑钮 | `About.module.css:23` | 实白圆钮浮在头像上 | L2 | 清透磨砂小钮 | 否 |
| 顶部淡出 | `EdgeFade.module.css:17-28` | 两层模糊 | L2 | 加 `var(--seal,)` 即可 | 否 |
| 侧边栏 | `App.module.css:103`；`Workspace.tsx:341` | 系统原生材质 + 渐层描边 | 原生 | 保留（网页无法折射桌面） | 否 |
| 详情栏、主面板 | `App.module.css:188,377` | `--surface-page/pane` 薄本色 | 原生 | 保留 | 否 |
| 档案预览头 | `Files.module.css:53` | 实底 + 分隔线 | 硬边 | 保留 | 否 |
| 原生提示（`title`）、右键/应用菜单 | 各处 `title=`；`ApplicationMenu.tsx` | 系统绘制 | — | 不在范围 | — |

### 2.1.1 补充盘点（用户：「我建议你再找找有没有漏掉的组件，比如设置里面的模型选择那些的」）

以真实后端起应用、逐个设定分类与模型子页截图核对，上表漏列：

| 组件 | 位置 | 现状 | 处理（第 6 步） |
| --- | --- | --- | --- |
| 原生下拉框 | 9 个文件约 18 处：`ModelPurposes`（模型用途 8 处）、`ModelSchemaFields`、`ServerSettings`、`AgentConnector`、`ConnectorTasks`、`LocalBot`、`NativeRequest`、`Settings`、`ModelUsage` | 设定行里是 `--bg-elevated` 实色块，透明磨砂下最突兀；用量筛选是另一种小号写法；其余无类名，取浏览器默认 | 一条全局字段样式（低优先级 `:where`），删去各模块重复的字段规则 |
| 文本输入与多行输入 | 這台電腦名称、模型表单、伺服器位址、对话搜索、工作行内、电脑说明、关于页编辑 | 圆角 6/8px、细线 `--separator`/`--separator-strong`/`--line`、底色实白或 `--bg-content` 混用；這台電腦名称框文字被截断 | 同上 |
| 原生复选框 | `AgentConnector`（连接授权）、`ModelProbes`、`ModelSchemaFields` | 浏览器默认方块 | 强调色、统一尺寸，保留原生语义 |
| 折叠块 `details/summary` | `ServerSettings`、`AgentConnector`、`TailscaleGuide`、`ModelConnections`、`ModelPurposes`、`ModelSchemaFields`、`Files`、`ConnectorTasks`、`Works`、`ModelUsage` | 浏览器默认三角与各自写法共 5 种 | 全局同一旋转箭头；用量页「历史」是行末箭头的列表行，属另一交互，保留 |
| 新增连接对话框的服务商按钮 | `ModelSettings.module.css` `.presets` | 「自訂（OpenAI 相容）· Responses」溢出按钮 | 允许换行 |
| 「模型连接」只有一个按钮的卡片 | `ModelConnections.tsx` | 空卡片里一个按钮 | 改为设定行（标题、说明、按钮） |

### 2.2 在滚动容器里的玻璃

夹具中逐个元素查最近的 `overflow: auto/scroll` 祖先（只列有 `backdrop-filter` 的）：

| 玻璃 | 所在滚动容器 | 说明 |
| --- | --- | --- |
| 对话气泡、工作卡片 | `.messages`（`role=log`） | 真正在滚；Q1 选 L2 也仍是 `backdrop-filter`，同样受影响 |
| 设定页开关、分段滑块 | `.pane`（`role=tabpanel`） | 改为静止不挂滤镜后，只剩按住期间 |
| 工作页分段滑块 | `.list` | 同上 |
| 组件展示页工具组、滑块、卡片 | `App.module.css` `.content`（`overflow: auto`） | 对话页的输入框、只读条也在 `.content` 内；聊天时 `.content` 本身不滚动 |
| 配对欢迎卡片 | `.welcome`（`overflow: auto`） | 窗口矮时会滚 |
| 角色切换菜单 | 侧栏 `nav`（`overflow-y: auto`） | 协调方已确认失效，正迁到顶层 |
| 对话框、命令面板 | 顶层（`showModal`） | 不受滚动祖先影响，仍需真实窗口确认 |

真实窗口核对（第 5 步）的结论：两种假设都不成立。只声明 `overflow: auto` 的对话内容区（输入框、探针）、侧栏、以及真正滚动中的设定页，模糊都有效；上表的玻璃不必移出滚动区。

## 3. 玻璃层级

每层一个滤镜令牌（`tokens.css`），组件只引用令牌。所有带 `backdrop-filter` 的层都以 `var(--seal,)` 结尾；不透明模式、强制色彩、增强对比沿用现有路径（`materials.css:46-66`）。

| 层级 | 用途 | 外观 | 令牌（建议） | 复用的 glass.ts 机制 | 每个元素的开销 |
| --- | --- | --- | --- | --- | --- |
| L0 内容 | 卡片、行、字段、内容内横幅、徽章、玻璃上的按钮与行 | 半透明填充 + 细线；磨砂下不用实白 | `--surface-card`（并入 `--bg-raised`）、`--fill-control`、`--field-line` | 无 | 0 |
| L1 静光 | 静止的开关/分段/滑杆滑块；Q2 若选是则含页面上的次要按钮 | 本色填充 + 方向光照（切片光照图作遮罩）+ 指针光；无 `backdrop-filter` | 沿用 `[data-glass]::after` | 光照切片 `rimTile`、指针光 | 一张共享切片，0 滤镜 |
| L2 磨砂 | 浮在内容上但不需要透镜的小件：浮动通知、悬浮操作条、提示气泡、错误气泡、顶部淡出；Q1 若选磨砂则含气泡和工作卡片 | 模糊 + 压对比 + 薄着色 + 切片光照 | `--glass-frost: blur(12px) saturate(160%) var(--glass-calm) var(--seal,)` | 光照切片、指针光 | 一次 `backdrop-filter`（只模糊；实测 40 块无可测成本） |
| L3 透镜·浮动 | 工具组、工具列胶囊、输入框、只读条、新消息胶囊；按住中的滑块 | 清透，边缘弯折 + 色散（仅 `toolbar`/`composer`） | `--glass-lens: var(--refract,) blur(1px) saturate(116%) var(--glass-calm) var(--seal,)` | `useGlass` 全套 | 一个 SVG 滤镜（色散为三次位移） |
| L3 透镜·面板 | 对话框、命令面板、角色菜单、欢迎卡片 | 厚磨砂 + 边缘弯折，形变后渐入 | `--glass-pane: var(--refract,) blur(24px) saturate(160%) var(--glass-calm) var(--seal,)` + `--mat-pane` | `useGlass`、`emerge` | 一个 SVG 滤镜 |
| L3 透镜·清透 | 电脑画面工具列（媒体之上） | 更透明，靠深色底作变暗层 | `--glass-clear: var(--refract,) blur(12px) saturate(150%) contrast(0.84) brightness(0.88) var(--seal,)` + `--glass-dim` | `useGlass` | 一个 SVG 滤镜 |
| L4 有色 | 主要按钮、发送按钮 | 平涂有色 + 同色边光 | 现有 `--tinted` | 指针光 | 0 |

施工取值（第 3 步）：令牌声明在 `[data-glass]` 上而非根元素，否则 `var(--refract,)` 在根上就被解析为空。浮动透镜沿用输入框原写法（1px 模糊）：工具组原 6px 模糊多余，它下面的内容已由顶部淡出层磨砂；面板沿用对话框原写法（先模糊 24px 再折射），欢迎卡片 28px→24px；清透沿用电脑工具列原写法。按住中的滑块用浮动透镜。

规则：玻璃上不再放玻璃（L2/L3 内的子元素只用 L0，按住中的滑块例外，这是苹果的「临时升起」）；Regular 与 Clear 不混在同一区域；层级只由组件决定，不按内容或平台切换。

`glass.ts` 需要的改动（只改生成方式，接口不变）：

1. 光照切片：圆角矩形的光照只取决于法线和到边的距离，沿直边恒定。按（种类, 圆角, DPR）生成一张 `(2B+1)²` 的切片（B 取法线圆角与亮带宽的较大者，元素小于 `2B+1` 时取半边长，此时切片即原图），`[data-glass]::after` 改用 `-webkit-mask-box-image: var(--rim) <B·DPR> fill / <B>px`（Chromium 156 只支持带前缀写法，`mask-border` 不支持）。任何尺寸、窗口缩放都不再生成光照图。
2. 位移切片：非放大类（toolbar/composer/bubble/card/sheet）同理按切片缓存，元素尺寸变化时用 9 次 `drawImage` 拼成整图再编码（实测 480×788 对话框编码 0.7ms，x6 4.9ms；原整张生成 21.4ms，x6 107.4ms）。放大类（slider/toggle/segment，内部有整体放大，不能拉伸）本身很小（0.6–2ms），按静止尺寸生成一次，交互中拉伸不重算。气泡进场外扩时切片包含外扩边距。
3. 动态玻璃（`dynamic = true`）静止时不设 `--refract`、不挂滤镜，首次按下时生成贴图（同尺寸共享）；松开回弹结束后撤掉。同一时刻只有一个控件被按住。
4. 指针光：`--pointer-x/y` 注册为不继承，`followPointer` 只写到在场的发光元素（`useGlass` 与 `usePress` 的主要/发送按钮登记），`::after`/`::before` 中 `--pointer-x: inherit`。
5. 物化：形变结束、贴图就绪后，弯折强度用现有弹簧采样在约 180ms 内由 0 升到 1；减少动态效果时直接为 1。

可以删除：`--mat-thick`、`--mat-hud`、`--blur-chrome`；`.ranges`、`.groupTabs` 自写样式；`Computer.module.css` 自带的压对比；按精确尺寸的 LRU 缓存（改为切片缓存，条目数等于用到的圆角种类）。

## 4. 开销预算

| 编号 | 预算 | 现状 | 怎样做到 |
| --- | --- | --- | --- |
| P1 | 同一视口内带折射（`url(#yuki-glass-*)`）的元素 ≤ 12 | 对话页 7（含 4 个气泡）；Metal 实测再加 24 块小折射才开始掉帧，软件每块 +0.4–0.6ms/帧 | 静止控件不折射；内容层不折射（Q1）；工具列胶囊至多 +3 |
| P2 | 静止页面上开关/分段/滑块的折射数为 0，与控件数量无关 | 每个控件 1 个 | 第 3 节改动 3 |
| P3 | 按住开关、拖滑杆、切换分段期间新生成贴图 0 张（首次按下除外） | 按住开关 10 张 | 改动 2、3 |
| P4 | CPU x6 下打开对话框/命令面板/角色菜单：某种玻璃第一次出现时贴图合计 ≤ 20ms，之后再打开 ≤ 5ms，且无 >100ms 长任务（原定 10ms 只按拼合编码估算，未计每种玻璃第一次画切片：实测切片两张约 13ms，x1 约 2ms，四象限对称只算一次距离无可测收益，未采用） | 贴图 104ms（对话框），长任务 75–142ms | 改动 1、2；大面板位移图每边上限 720→360 格（只在边框带内变化，点间平滑） |
| P5 | 窗口宽度连续变化时，每一步玻璃贴图耗时 ≤ 4ms（x6） | 输入框每步 55.9ms（x6） | 改动 1、2 |
| P6 | 软件渲染下滚动对话：平均帧 ≤ 18ms，>20ms 帧 ≤ 5%；Metal 下 0 帧 >20ms | 软件 27.6ms、152/239 帧；Metal 16.7ms、0 帧 | Q1 选磨砂时达成（实测 16.7ms、0 帧）；Q1 保留透镜时此条只对 Metal 成立 |
| P7 | 指针移动时每帧样式重算 ≤ 0.5ms（2.7k 节点对话页，x1） | 2.81ms | 改动 4 |
| P8 | 不可见元素（`opacity: 0`、`visibility: hidden`、零尺寸、未显示的胶囊）不带 `backdrop-filter` | 悬浮操作条每条消息都带（改造后） | 只在显示状态挂滤镜 |
| P9 | `seal` 不增加可测开销 | 实测 40 块 Metal 无差、软件 +1ms 以内 | 只是 alpha 线性变换 |
| P10 | 光照图数据 URL 总量与圆角种类数相关，与玻璃数量和尺寸无关 | 对话页 81KB、展示页 55KB，按元素累加 | 改动 1 |

## 5. 失败情形（先写，再写代码）

E2E：`liquid-glass.spec.ts`、`glass-quality.spec.ts`、`control-motion.spec.ts`、`conversation-glass.spec.ts`（修订），新增 `glass-tiers.spec.ts`（夹具页：组件展示、`showcase`、`settings`、`work`、`palette`、`conversation-scroll`、配对、角色切换）与 `native-glass.spec.ts`（真实窗口，仿 `mac-material-contrast.spec.ts`：`isolatedDesktop` 启动构建好的应用，`screencapture -l<windowId>` 截窗口）。产物：`glass-tiers.json`（每个元素的层级判定、计数、计时）、`glass-budget.json`（帧时间、长任务、贴图计时）、`native-glass.json` 与各截图。

层级与外观：

1. 第 2.1 节任一组件的实际层级与表中不符。判定只看计算样式：L0 无 `backdrop-filter` 且无光照遮罩；L1 有光照遮罩、无 `backdrop-filter`；L2 有 `backdrop-filter` 且不含 `#yuki-glass-`；L3 含 `#yuki-glass-`；L4 为有色底加同色边光。
2. 透明磨砂模式下任一 L2/L3 的 `backdrop-filter` 不以 `#yuki-backdrop-seal` 结尾，或同一层级的两个元素滤镜串不同。
3. 静止时任一带 `backdrop-filter` 的元素有同样带 `backdrop-filter` 的祖先（玻璃叠玻璃）；按住中的滑块不算。
4. 不透明模式、强制色彩或增强对比下，任一层级仍有 `backdrop-filter` 或半透明底；增强对比下 L2/L3 没有描边。
5. L0 字段（文字框、设定下拉、模型下拉、工作行内输入、电脑备注、关于页编辑框、SOUL 搜索框）的底色、细线颜色、圆角不完全相同，或透明磨砂下底色 alpha ≥ 0.9。
6. L0 卡片（设定分组、模型卡、工作成果、档案信息、关于页原文与待定、头像状态、头像编辑预览）的底色、圆角、细线不完全相同。
7. 用量页时间范围或分组不是 `Segmented`（`role=tablist/radiogroup` 内无 `[data-glass=segment]`）。
8. 光照切片渲染出的边光不满足既有光照规则（《苹果式打光》第 1–2 条），在元素上取像素：上边最亮，下边为上边 35%–100%，两侧中点暗于下边，亮带不宽于 2 个显示像素。
9. 同种类同圆角、宽度分别为 200px 与 600px 的两块玻璃：左上角 `B×B` 区域的边光像素差平均超过 2/255，或直边上相隔 100px 的两点边光差超过 2/255（切片拼接出错）。

交互与动画：

10. 静止的开关/分段/滑杆滑块带 `#yuki-glass-` 滤镜或 `data-refracting`；按住后 300ms 内仍没有；松开、回弹结束后仍有。
11. 设定页加入第二组开关后，静止时 `[data-refracting]` 的数量变化。
12. 对话框打开动画中，位移图的 `scale` 在形变结束后不是逐帧递增到最终值（有一帧由 0 直接跳到最终值）；减少动态效果时第一帧不是最终值。
13. 主要按钮、发送按钮或任一 L2/L3 玻璃在指针靠近边缘时边光不比指针远离时亮（光源改写法后失效）；根元素上仍有 `--pointer-x`。

开销（以 init script 计 `toDataURL`/画布创建次数与耗时，CDP 设 CPU 降速，`PerformanceObserver` 记长任务）：

14. 视口内任一时刻带 `#yuki-glass-` 的元素超过 12 个（P1，逐个夹具页检查）；任一不可见元素带 `backdrop-filter`（P8）。
15. 首次按下之后，再按住开关 500ms、拖动滑杆 20 步、在分段之间切换 4 次，期间生成任何新贴图（P3）。
16. CPU x6 下打开对话框、命令面板、角色菜单，贴图耗时合计超过 10ms 或出现超过 100ms 的长任务；窗口宽度逐像素变化 20 次，任一步贴图耗时超过 4ms（P4、P5）。
17. 软件渲染下 `conversation-scroll` 程序滚动 240 帧，平均帧超过 18ms 或超过 5% 的帧超过 20ms（P6，Q1 选磨砂时）；2.7k 节点对话页指针移动 60 次，每次样式重算超过 0.5ms（P7）。

长对话（用户：「消息多了会卡顿」；`long-conversation.spec.ts`，夹具 `conversation-scroll&messages=300`，约 6.2k 节点，软件渲染）：

20. 输入框连打 30 字出现超过 50ms 的长任务，或总耗时超过 25 则消息时的 1.3 倍。实测原因：草稿是对话组件的状态，每打一字全部消息重渲、重解析 Markdown（300 则：1.73s、长任务 75–85ms；25 则：0.98s）。处理：草稿放进只有输入框订阅的小 store，发送仍按原文字取值。
21. 指针移动 60 次，300 则时每次样式重算超过 25 则时的 1.5 倍（且超过 0.5ms）（P7；原为 5.78ms 对 1.41ms，随节点数增长；CI 机器上绝对值约 1ms，故按同机比较）。
22. 程序滚动 120 帧，平均帧超过 18ms，或超过 5% 的帧超过 20ms（P6；原 25.2ms、117/120 帧，与消息数无关，来自每个可见气泡的折射）。

真实窗口（macOS，透明 vibrancy 窗口；产物为截图与 JSON）：

18. 对话气泡、工作卡片、设定页按住中的开关、配对欢迎卡片、输入框、工具组、角色菜单、对话框、命令面板：截取玻璃内背景区域与同一背景不加玻璃时的同一区域，玻璃内高频能量（拉普拉斯平方和）不低于后者的 50%（模糊没生效）；同时记录该玻璃最近的滚动祖先及其是否溢出，作为 2.2 假设的判定依据。
19. 页面表面是半透明本色时，玻璃内仍能看到背后清晰文字的轮廓：玻璃内高频能量高于玻璃外同一文字区域的 35%（`seal` 失效）。

本任务书修订既有用例：《液态玻璃统一》第 1 条中的「三种滑块」改为「按住中的三种滑块」（`liquid-glass.spec.ts:210-211`）；该文件 `rimLight` 按整张光照图取样，改为按元素渲染像素取样；《聊天细节与玻璃质量》第 4 条「光照图像素尺寸等于玻璃尺寸乘以显示像素比」改为「光照切片按显示像素比生成」；Q1 选磨砂时，《液态玻璃》第 15 条「气泡的滤镜是一次位移」与 `conversation-glass.spec.ts:227`、`glass-quality.spec.ts:47` 的 `data-refracting` 断言改为 L2 判定。

## 6. 实施顺序（每步一个 PR）

1. **贴图切片与指针光**（观感不变）：第 3 节改动 1、2、4，删除三个死令牌。验 8、9、13、15、16、17 的 P7 部分，以及既有光照、折射用例全绿。改前改后截图逐张比对。
2. **控件静止安静**：改动 3（动态玻璃按住时才折射），用量页改用 `Segmented`。验 7、10、11、15。
3. **层级令牌与物化**：`tokens.css` 加 `--glass-frost/lens/pane/clear`（含 `seal`），11 处折射玻璃改引用令牌，电脑工具列改清透令牌，改动 5。验 1、2、4、12。
4. **浮动小件补齐**：新消息胶囊（L3）、浮动通知、悬浮操作条、提示/错误气泡、头像编辑钮、电脑问题提示（L2）；Q3 的工具列胶囊。验 1、3、14。
5. **滚动容器与真实窗口**：跑 `native-glass.spec.ts` 第 18–19 条，按结果把失效的玻璃移出滚动容器（顶层或固定定位）或降为 L0/L1。
6. **内容层统一**：字段、卡片、内容内横幅、次要按钮（按 Q2）。验 5、6。
7. **对话内容层**（按 Q1）：气泡、工作卡片改层。验 17 的滚动部分与修订后的对话玻璃用例。

每步：Desktop CI 全绿；合并后用「Yuki Local Signing」打包装到 `~/Applications/Yuki.app`；报告分开写本地修改、验证、提交、推送、合并和本机更新，观感由用户确认。

### 6.1 施工进度（2026-11-12）

用户：「不用拆太多 PR，CI 要等很久的」。第 4、6 步后半与第 5 步合为一个 PR。

- 第 1–3 步：#69、#70、#71。第 6 步前半（字段、复选框、折叠块与补充盘点）：#72。
- 第 4 步：新消息胶囊为浮动透镜；对话顶部浮动通知、消息悬浮操作条（只在显示时挂滤镜）、菜单错误气泡、SOUL 提示、头像编辑钮为磨砂（`--glass-frost`，根上一值）；电脑画面问题提示为磨砂加失败色；代码块复制钮为填充。Q3：侧边栏、更多命令、重新启动以更新各在 `Capsule` 透镜胶囊里，原工具组也改用它，删去 `.toolbarGroup`。
- 第 6 步后半：次要按钮加 `data-glass="button"`，以现有绘制边光作静光（无滤镜、无贴图；指针光未给：一页数十个按钮各写位置，收益不抵开销）。内容横幅底色改为状态色混页面表面（透明磨砂下随之变薄）。卡片原已统一为 12px、细线、`--bg-raised`。
- 第 5 步：屏幕唤醒后完成（`native-glass.spec.ts`，macOS 真实窗口）。在 3px 条纹上，从屏幕各截一次「玻璃原样」与「拿掉它的滤镜」，逐像素平均差：输入框 95、工具列胶囊 37、命令面板 27、Yuki 选单 40；模糊探针在 body 层 122、对话内容区（只声明可滚动）112、侧栏 128、正在滚动的设定页 128（截图确认完全抹平条纹）。即滚动区不是失效条件，原 2.2 的假设与全局磨砂任务书的归因均更正。侧栏选单当时失效的确切条件，以「z-index 3 包裹内绝对定位」等四种结构的探针都复现不出，未查明；选单已在顶层且有效。第 18 条以「每块玻璃的开关差 > 10」验证；第 19 条（seal）已由《全局透明磨砂》的 `native-frost.spec.ts` 覆盖。

## 7. 待用户决定

- **Q1 对话气泡与工作卡片**：它们在滚动列表里，属于内容。苹果的规则是玻璃不放在内容上。实测软件渲染下气泡折射让滚动从 16.7ms 变成 27.6ms，只保留模糊和边光时回到 16.7ms；你本机（M6，Metal）两者都没有掉帧。建议：改为磨砂（L2），保留光照和色调，去掉折射。另一个选择是保留透镜，P6 只对有显卡的机器成立。
- **Q2 页面上的次要按钮**：做成静光玻璃（L1，有方向边光和指针光，零开销），还是保持现在的平涂填充？建议做成静光玻璃。
- **Q3 工具列里单独的按钮（側邊欄、更多命令、更新）**：像 macOS 26 那样各自放进透镜胶囊，每个多一个折射元素。还是保持透明图标？建议放进胶囊。
