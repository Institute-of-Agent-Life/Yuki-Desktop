# Yuki Desktop

Yuki 的跨平台桌面客户端。通过个人 API 与独立的 Yuki 后端连接，继续对话、查看原工作、补充要求和处理文件。

首次打开可以连接已有 Yuki、部署本地 Yuki，或者先浏览。没有服务器地址也能进入设置和帮助，不会自动连接或部署。

## 安装包

| 平台            | 架构                 | 格式               |
| --------------- | -------------------- | ------------------ |
| Windows         | x64                  | NSIS 安装程序      |
| macOS 13 及以上 | Intel、Apple Silicon | DMG、ZIP           |
| Linux           | x64、ARM64           | AppImage、DEB、RPM |

每个包携带本平台的独立 Connector 和 Python 运行环境，使用者不需要安装 Python。Codex、Claude Code 或其他原生 Agent 仍由使用者安装并登录；Docker 也由使用者自行安装。桌面不会替换这些工具的登录配置。

CI 会分别构建这五个目标、检查原生 SQLite 与内置资源，并上传未签名安装产物。正式签名、公证及各桌面环境的安装体验需要分别验收；构建成功不代表已正式发布。Linux 系统托盘取决于桌面环境的 AppIndicator 支持。

## 连接和使用

已有 Yuki 时，在已支持的平台私聊中发送 `/ai link`。后端配置 `CLIENT_PUBLIC_URL` 后会给出完整配对链接，可直接粘贴到桌面；只有配对码时，也可以手动输入地址。配对先核对公开角色信息，再用原设备凭据确认本人入口。收到凭据后遇到网络错误，可继续原配对，不再兑换已经用过的码。

本地部署会在明确选择的新目录中保存配置与数据，通过 Docker Compose 启动仅供本机访问的 Bot，然后创建本人入口并配对。模型协议、地址、模型名和凭据由使用者填写；不需要 QQ、Telegram 或飞书账号。无密钥的本地模型可以留空密钥。退出桌面不会停止本地 Bot；启停入口在本地部署页。已有其他部署可通过连接入口接入，不会被本向导接管。

设置中的“编程 Agent”用于让当前 Yuki 使用这台电脑上的原生 Agent。普通入口使用内置 Connector，经明确授权后连接；可以发现安装、选择项目、配置实例、诊断连接并管理同一用户服务。已有独立安装可以明确选择可执行文件和数据目录，或采用内置版本继续使用原数据。关闭桌面不会自动取消原生任务。

从项目或已有会话提交的要求，连同明确选择的实例、会话及原操作目标，进入 Yuki 现有 Main/Work。聊天回执表示要求已送达；原生进度、待回答问题、停止跟进与取消的实际结果分别显示。网络中断后按原请求和操作查询，不自动重新派发。

对话支持附件、录音和服务器实际返回的语音转写。附件与成果使用原来源、指定版本和 SHA-256 校验；来源不可读时显示实际错误。工作页使用当前公开 Work，可以在原工作中补充要求或取消。SOUL 编辑依实际所有权和原保存结果处理。指令面板搜索已加载的内容，不宣称已经搜索完整服务器历史。

旧 VNC、电脑控制、文件执行器、头像写入及未提供的目录页面已退出产品。已有本机历史仍可在设置中查看和导出，不重放旧执行，也不自动改写旧数据库记录。

## 开发

需要 Node.js 22.12 以上，后端及 Connector 构建需要 uv。先检出 [contracts/source.json](contracts/source.json) 固定的后端提交：

```sh
npm ci
node build-tools/prepare-connector.mjs --backend /absolute/path/to/Yuki
node build-tools/prepare-local-bot.mjs --source /absolute/path/to/Yuki
npm run dev
```

Connector 构建使用锁定的 Python 归档及依赖，迁移到中文路径后运行实际探针，再生成资源清单。本地 Bot 模板与镜像使用同一后端提交；临时测试镜像可以通过 `--image` 显式指定。

```sh
npm run lint
npm run typecheck
npm run check:contract
npm test
npm run test:release
npm exec playwright install -- --with-deps chromium
npm run test:e2e
npm run package:dir
npm run check:package
```

真实后端联调使用显式设置的 `YUKI_BACKEND_TEST_ROOT` 和 `YUKI_BACKEND_TEST_PYTHON`。测试装配当前后端的真实数据库、身份、HTTP、SSE 和回执，仅替换付费模型调用；CI 缺少该环境会失败。本地未设置时，这组用例会标为跳过。

桌面联调使用临时用户目录，并隔离系统协议注册、剪贴板和外部打开操作。更新 UI 回归另模拟打包状态及更新 SDK 的下载、安装结果，验证取消、错误、退出与草稿恢复；这不等于真实安装、签名或自动升级验收。

本地部署回归通过 `YUKI_TEST_DOCKER=1 npm test -- tests/unit/local-bot.test.ts` 启用，会创建独立的临时 Compose 项目。CI 有单独必跑任务，实际构建镜像、初始化、启动并配对。它不连接生产 Bot。

`npm run package -- --win --x64`、`--mac --arm64` 等命令生成本平台安装包。跨平台产物由对应系统的 CI runner 构建。打包前必须准备对应平台的 Connector 及本地部署资源；检查不会把缺失资源当成可发布产品。

## 兼容与数据

需要 Client API revision 6；固定 OpenAPI、生成类型及后端来源见 [contracts/source.json](contracts/source.json)。本次增加的原生 Agent 目录和目标字段依赖对应后端提交，单独升级桌面不会升级服务器。

凭据由主进程交给系统安全存储；系统不支持持久加密时使用既有的会话语义。消息、工作命令和文件上传保留原 UUID 与回执。登出时可明确保留或删除本机数据；服务器历史与使用者另存文件各有自己的生命周期。

本项目采用 AGPL-3.0-only，参见 [LICENSE](LICENSE)。
