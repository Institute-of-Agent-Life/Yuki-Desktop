# Yuki 模型与 Provider 配置补全、全局权限统一任务书（2026-10-31，施工版）

> 目标：让用户在 Yuki Desktop 里配置**所有与 LLM 相关的东西**——模型连接（Provider）、API Key、每个用途用哪个模型、Embedding、视觉、语音转写、参与判断（semantic observation）、联网搜索。
> 权限决策：**删除角色 owner 这套独立资格，所有原 owner 权限统一归现有 Person 超级管理员。** Desktop 使用本人设备凭据识别当前 Person 的真实超管资格；已是超管的人登录后直接使用管理功能，不再另授 owner，也不要求另取 operator 凭据。
> 本文跨两个仓库：后端 `Yuki`（下称 **B**）与桌面端 `Yuki-Desktop`（下称 **D**）。执行者按章节逐步施工；遇到本文没写到的情况**停下来报告**，不要自行发明机制。
> 基线：D `origin/main` = `e22d696`；B `origin/main` = `59ad2181`。
> 状态：用户已正式授权整份任务书实施、分阶段提 PR 与合并；B-1 的人物设备管理权限变更也已获本次授权，无需重复确认。当前开始施工；本地修改、验证、提交、合并、本机更新及上线分别记录，不能互相代替。

---

## 第 0 章 开工前必读

### 0.1 同步基线（每次开工都做）

```sh
# 两个仓库分别执行
git fetch origin
git status -sb      # 必须是 "## main...origin/main" 且没有 behind；落后就 git pull --ff-only
```
工作区有未提交改动时**先报告**，不要 stash/reset/checkout 覆盖。B 的本地主工作区 `D:\Code\My_Github_Repo\Yuki-QQbot` 目前停在旧提交、而且有用户未提交的改动，**不要在那里施工**；用 `git worktree add` 从 `origin/main` 另开工作区。

### 0.2 禁止防御性编程（两仓库共同最高约束）

B 的 `AGENTS.md`、D 的 `AGENTS.md` 第一条都是：**禁止防御性编程。能删除或放宽条件解决的，不新增替代机制；非必要不加代码。**

本任务中**一律禁止**：

| 禁止 | 正确做法 |
| --- | --- |
| 为 Desktop 另写一套模型配置的业务逻辑、校验或存储 | 复用 B 现有 `ConfigFileService`（`src/yuki/admin/config_files.py`）与 `admin/operations/models.py`；Desktop 只做呈现 |
| 恢复 character owner、另建“实例所有者”或设备管理员角色，或让所有已配对者修改全局设置 | 统一使用现有 Person 超管资格；设备凭据解析真人身份，后端在实际执行处核当前权限 |
| 将旧 owner 授权行自动转换成超管，或让配对/重连自动授超管 | 现有超管资格保持原事实；可信部署初始化沿 B-2 显式授予，普通配对不改变权限 |
| 新增与 `/admin/v1/models` 平行的第二套路由（例如 `/client/v1/models` 复制一份） | 让现有管理路由接受个人设备的人物身份（B-1），一套路由两种凭据 |
| 在 Desktop 校验 URL 格式、模型名、能力组合 | 后端 `ModelProfile` 校验器已经做了；把后端的 `validation_error` 原样显示 |
| 读取/缓存/回显 API Key 明文（包括"显示后四位"） | 只显示"已儲存"（来自 `saved_api_key_profiles`）；Key 输入框只写不读 |
| 保存失败自动重试、换 request_id 重发 | 保留原 request_id，按原回执查询（admin-api.md "回执与效果"） |
| 连接测试失败后自动换模型、换协议 | 只报告结果 |
| 为旧环境变量（`LLM_*`、`MEMORY_EMBEDDING_*`）写永久兼容层 | 迁移一次后删除旧读取路径；需要过渡的，写明真实调用者与退出条件 |
| 前端维护一份 Provider 预设表 | 预设由 B 返回（B-3），前端只渲染 |
| 加"确定要保存吗？"确认框 | 只有删除连接和更换 Embedding（会触发重建索引）需要确认 |

**必须保留的事实约束（不是防御性编程）**：bundle revision CAS（`expected_revision`）、request UUID 幂等、密钥永不回传、`apply_mode`（热应用/需重启）如实显示、已开始的模型请求保持原连接、Embedding 换配置生成新 profile 而不是覆盖旧向量。

### 0.3 测试规则

- 不写单元测试补课。B 的验证按 B 仓库现行测试政策；D 的验证用 E2E，产出截图与 JSON 产物（写到 `test.info().outputPath(...)`）。
- D 的 E2E 需要 `YUKI_BACKEND_TEST_ROOT` / `YUKI_BACKEND_TEST_PYTHON` 指向 B 的测试 checkout；未设置时测试会 skip，**skip 不等于通过**，报告里单列。

### 0.4 报告格式

分别写：本地修改 / 验证（命令与结果，skip 单列）/ 是否提交 / 是否推送 / 是否开 PR / 是否部署。没验证的不写"完成"。未经用户授权不推送、不合并、不部署。

---

## 第 1 章 外部产品调研结论

| 产品 | 怎么加 Provider | Key 存哪 | 模型怎么选 | 多用途模型 | 值得借鉴 |
| --- | --- | --- | --- | --- | --- |
| **OpenClaw**（开源 personal agent） | Control UI「Settings → Models」或 `openclaw models auth paste-api-key`；内置 provider 插件 + `models.providers` 自定义 base URL | 独立 auth store（per-agent SQLite），配置里只放引用；页面"显示凭据来源但不显示 Key" | 从刷新的模型目录里选 | **Defaults 卡**：主模型、utility 模型（标题、摘要等小任务）、decision 模型（布尔/打分判断），各自可设 fallback | ①Key 与连接配置分离 ②「保存 Key」与「刷新目录」是两个独立结果，刷新失败 Key 仍保存 ③**Test connection** 发一次真实请求，报告延迟或分类错误（认证/限流/计费/超时） |
| **Hermes Agent**（Nous Research） | `hermes model` 交互选 provider 与模型；也支持 OAuth（订阅制） | 密钥在 `~/.hermes/.env`，非密钥在 `config.yaml`；`hermes config set` 自动分流 | 交互列表 | Web/图像/TTS 等工具各自一个 backend 选择键 | 密钥与普通配置分文件、由同一个命令写入正确位置 |
| **AnythingLLM** | Settings 里每类能力单独一页 | 应用内管理，不让用户改 `.env` | 下拉 | **LLM、Embedder、语音转写、TTS 各自独立选 Provider**；Embedder 系统级，更换需重新嵌入并明确警告 | 能力分页；更换 Embedding 时的警告文案 |
| **Cherry Studio** | 设置→模型服务：内置服务商列表 + 自定义（选 API 格式 OpenAI/Anthropic/Gemini） | 本地；支持一个服务商多个 Key 轮询 | 「获取模型列表」→ 勾选加入；只显示加入的 | **默认模型**：默认助手、快速（命名/关键词）、翻译、绘画 | 「检测」按钮选模型测试；服务商启用开关；显示上游真实模型 ID |
| **LobeChat / LobeHub** | 设置→AI 服务商；可新建自定义（ID、名称、请求格式、代理地址、Key） | 服务端/本地 | 「获取模型列表」，按类型分组（Chat/Embedding/ASR/TTS/图像） | 系统助手模型（话题命名、翻译等） | **连通性检查**发 `hello` 给所选模型；模型按类型分组 |
| **Letta** | `/connect` 添加 provider（含 OpenAI 兼容自定义） | BYOK | `/model` 选择，`provider/model` 句柄 | 每个 agent 独立 `model` 与 `embedding` | 自定义网关时显式让用户选 reasoning 档位，不从模型名猜 |

**共性（我们要做到的最低标准）**：
1. 预设列表 + 自定义（选协议、填地址）。
2. Key 只写不读，显示"已保存/来自环境变量"。
3. **测试连接**（真实请求，报告延迟和分类错误）与**获取模型列表**是两个独立按钮。
4. "主模型"之外有"用途 → 模型"的分配表（OpenClaw 的 utility/decision、Cherry 的默认模型）。
5. Embedding / 语音 / 视觉 是**独立能力页**，更换 Embedding 有明确后果提示。

---

## 第 2 章 Yuki 现状审查（为什么桌面端配不了模型）

### 2.1 后端已经有的

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 模型目录 v3 | B `webui-config/model_profiles.toml`；`src/yuki/model_runtime/profiles.py`、`models.py` | `profiles`（每个 = provider+protocol+base_url+api_key_env+model+参数+capabilities）、`routes`（6 个 `ModelTask` → profile）、`search_backend`/`search_connection`、`semantic_observation` 段 |
| 密钥 sidecar | `model_profiles.secrets.json`，`src/yuki/model_runtime/secrets.py` | 与 TOML 共用 bundle revision；读取不回传 |
| 原子保存 + 热应用 | `ConfigFileService.save()` | 校验、预建连接池、原子写、`apply_catalog` 热切换，失败回滚 |
| 管理 HTTP | `GET /admin/v1/models`、`POST /admin/v1/models/apply`、`POST /admin/v1/models/secrets`（`src/yuki/admin_api/http.py`） | 返回 `document`、`revision`、`apply_mode`、`profile_schema`、`tasks`、`saved_api_key_profiles`、`semantic_providers`、`matches_loaded`… |
| Provider 方言预设 | `src/yuki/llm/vendor_policy.py`；文档 `docs/architecture/model-providers.md` "Chat 供应商预设" | openai/azure/deepseek/qwen/moonshot/zhipu/doubao/minimax/openrouter/groq/mistral/siliconflow/together/xai/openai_compatible |
| 运行时配置覆盖 | `RuntimeConfigService` + `src/yuki/admin/config_specs_*.py` | 含 `vision.*`、`asr.*`、`memory.*`、`web.tavily_api_key`、以及旧的 `llm.*`（`llm.model`、`llm.temperature`…） |
| 人物超管能力 | `src/yuki/admin/control_resolution.py` `SUPERUSER_CAPABILITIES` | **已经包含** `control.config.file.content.read` 与 `control.config.file.mutate` |
| 旧 owner 层退役 | B `d6b4ec16`（PR #523），D `1d42784`（PR #11） | 旧独立授权检查及 UI 门禁已删除；当前共享功能改为有效配对即可使用，`viewer.is_owner` 等仍有残留；本轮统一归 Person 超管，不能恢复旧 owner |

### 2.2 缺口（根因）

| # | 缺口 | 证据 |
| --- | --- | --- |
| C1 | **Desktop 拿不到授权**：`/admin/v1/*` 只认 operator 凭据（`attach_admin_api` 的 `principal()` 调 `access.authenticate(..., source=CLI)`）；Desktop 只有个人设备 token（`/client/v1`），而 `/client/v1` 没有任何模型路由 | D `contracts/client-api.openapi.json` 42 条路径无模型相关 |
| C2 | **配置分散在四套系统**：①`model_profiles.toml`（聊天/记忆/插件/结构化/搜索/语义）②运行时覆盖（`vision.*`、`asr.*`、`web.tavily_api_key`、旧 `llm.*`）③**纯环境变量**（`MEMORY_EMBEDDING_PROVIDER/BASE_URL/API_KEY/MODEL/DIMENSIONS…`，`config.py` 第 234–237 行起；运行时覆盖只有 `memory.embedding_enabled`）④旧 `LLM_*`/`LLM_FLASH_*` 环境变量仍作为 TOML 的 `*_env` 引用值（`model_profile_environment()`） | 见对应文件 |
| C3 | **Embedding 只支持一家**：`src/yuki/memory/embedding/` 只有 `qwen.py`（`provider_id="qwen_dashscope"`）；视觉只有 `src/yuki/vision/qwen.py`；ASR 借用 Qwen 地址/Key | — |
| C4 | **没有"测试连接""获取模型列表"** | B 全仓搜索 `list_models|test_connection|/v1/models` 0 结果 |
| C5 | **没有给 UI 用的 Provider 预设目录**（除了语义观察的 `provider_catalog()`） | — |
| C6 | **本机部署的用户不是超管**：`deployment_setup/desktop.py` 的 `pair()` 创建 Person 后只签配对码，文档写明"不默认授予 Person 超管"→ 就算 C1 修好，本机部署用户也配不了自己的模型 | `docs/operations/desktop-local-deployment.zh-CN.md` |
| C7 | **Desktop 只有部署时一次性的模型表单**（`LocalBot.tsx`：协议、地址、模型、Key），部署后无法修改；且只配主模型，`WEB_MODE=disabled`、`MEMORY_EMBEDDING_ENABLED=false`、`VISION_ENABLED=false` 写死 | `deployment_setup/desktop.py` `configure()` |
| C8 | **旧权限分裂的修复不完整**：旧资料编辑只认 `character_owner_grants`，超管也可能被拒；删 owner 后当前共享资料、SOUL、服务器电脑等只核配对有效性，未统一到 Person 超管 | B `character/repository.py`、`avatar.py`、`soul.py`、`client_api/computer.py`、`computer_commands.py`；历史 PR #523 |
| C9 | **权限投影仍残留 owner 语义**：`viewer.is_owner` 和 SSE `is_owner=true` 不代表真实超管；现有 `control.character.read/mutate` 也尚未列入 `SUPERUSER_CAPABILITIES` | B `character/repository.py`、`client_api/models.py`、`views.py`、`admin/control_resolution.py`；D 生成合同与 `shared/sync.ts` |

### 2.3 用途（Task）清单——UI 要覆盖的全部 LLM 相关配置

| UI 名称（繁体） | 后端事实 | 当前存放 |
| --- | --- | --- |
| 對話與工作 | `routes.chat_agent`（需要 `tools` 能力） | TOML |
| 記憶擷取 | `routes.memory_extraction` | TOML |
| 自我反思 | `routes.memory_self_reflection` | TOML |
| 記憶夢境整理 | `routes.memory_dream` | TOML |
| 插件 Agent | `routes.plugin_agent_session`（需要 `tools`） | TOML |
| 結構化小任務 | `routes.utility_structured` | TOML |
| 聯網搜尋 | `search_backend`（`model`/`tavily`）+ `search_connection` + 每个 profile 的 `search_mode`；Tavily Key | TOML + 运行时覆盖（`web.tavily_api_key`） |
| 參與判斷 | `semantic_observation`（jev / tencent_jev / aliyun_decision / custom） | TOML |
| 記憶向量（Embedding） | `MEMORY_EMBEDDING_*` | **仅环境变量** |
| 圖片理解（表情描述、插件 `VISION_ANALYZE`） | `vision.*` | 运行时覆盖 + 环境变量 |
| 語音轉文字 | `asr.*` | 运行时覆盖 + 环境变量 |

---

## 第 3 章 目标设计

### 3.1 一句话

**一份文档、一套接口、一个页面**：所有 LLM 相关配置收进 `model_profiles.toml` 这一份 bundle（密钥进同目录 sidecar）；`/admin/v1/models*` 是唯一读写接口，并接受"超管人物的个人设备"；Desktop 在"设定 → 當前 Yuki → 模型"里完整呈现。

**一套人物管理资格**：名字、头像、人格、服务器共享电脑等原 owner 权限与模型配置统一归 Person 超管。UI 统一称“管理員”，不显示“角色拥有者”或另设 owner 授权入口。

### 3.2 后端文档结构（v3 内追加段，不升 schema_version，旧文件无新段时行为不变）

```toml
schema_version = 3

[profiles.deepseek-chat]          # 已有，不变
provider = "deepseek"
protocol = "chat_completions"
base_url = "https://api.deepseek.com"
api_key_env = "DEEPSEEK_API_KEY"
model = "deepseek-chat"
# ……其余已有字段

[routes]                          # 已有，不变
chat_agent = "deepseek-chat"
# ……

[semantic_observation]            # 已有，不变

[embedding]                       # 新增（B-4）
enabled = true                    # 新段以此控制启停，默认 true
provider = "qwen_dashscope"       # 或 "openai_compatible"
base_url = "https://dashscope.aliyuncs.com/api/v1"
api_key_env = "DASHSCOPE_API_KEY"
model = "qwen3.7-text-embedding"
dimensions = 1024
# output_type / query_instruct / document_template_version 可选，省略取现行默认

[vision]                          # 新增（B-5）
enabled = true
base_url = "…"
api_key_env = "…"
model = "qwen3.7-plus"

[asr]                             # 新增（B-5）
enabled = true
protocol = "chat_completions"
base_url = "…"
api_key_env = "…"
model = "qwen3-asr-flash"

[search]                          # 新增（B-5），只放 Tavily 的密钥引用
tavily_api_key_env = "TAVILY_API_KEY"
```

规则：
- 段**不存在**时沿用现行环境变量/运行时覆盖（这是升级过渡，见 B-7 退出条件）；段**存在**时以段为准，环境变量不再补洞（与 `semantic_observation` 现行规则一致，admin-api.md 第 123 行）。
- 施工补充：`embedding`、`vision`、`asr` 新段各有 `enabled: boolean`（默认 true）。段存在时启停与模型身份都以该段为准；`enabled=false` 明确关闭且不回退旧 enabled/身份值。段缺失才沿旧环境变量/运行时覆盖过渡，防止旧本机部署的 enabled=false 使新配置保存后仍不工作。并发、超时等行为参数继续沿原来源。
- 所有 `api_key_env` 都引用 sidecar 中的别名或进程环境变量，与 profile 相同。
- 并发、超时、限流、保留天数等**非模型身份**的参数继续留在运行时覆盖，不搬。

### 3.3 Desktop 信息架构

在 UI 布局任务书的"當前 Yuki"组里加一个分类 **`models`（模型）**，页面内用 Segmented 分三页：

```
┌ 模型 ─────────────────────────────────────────────────────────┐
│ [ 連接 | 用途 | 用量 ]                     套用方式：即時生效  │
├───────────────────────────────────────────────────────────────┤
│ 連接                                                           │
│ ┌ DeepSeek ───────────── api.deepseek.com ─── 金鑰：已儲存 ┐ │
│ │ deepseek-chat        對話·工具·思考          [測試] [編輯]│ │
│ │ deepseek-reasoner    思考                    [測試] [編輯]│ │
│ │                          [取得模型清單]  [新增模型]       │ │
│ └───────────────────────────────────────────────────────────┘ │
│ ┌ 阿里雲百煉 ─────────── dashscope… ───────── 金鑰：環境變數 ┐ │
│ │ qwen3.7-plus         對話·圖片                [測試] [編輯]│ │
│ └───────────────────────────────────────────────────────────┘ │
│                                          [新增連接]            │
└───────────────────────────────────────────────────────────────┘
```

- **「連接」卡片是纯前端分组**：把 `base_url + api_key_env + protocol + provider` 相同的 profiles 归为一张卡，卡内每行一个 profile（一个模型）。后端 schema 不变。
- 「新增連接」：Sheet，第一步选预设（来自 B-3 目录，含"自訂（OpenAI 相容）""自訂（Anthropic）""自訂（Gemini）""本機（Ollama / LM Studio）"），第二步填 Key（可留空表示无鉴权）、地址（预设已填）→ [測試連接] → [取得模型清單] 勾选 → 儲存。
- 「新增模型」：在同一连接下新建 profile，复制连接字段，填模型 ID（或从清单选）。
- 「編輯」：Sheet 显示该 profile 全部可编辑字段，分"基本"（模型 ID、显示用途能力勾选）与"進階"（思考开关/档位、输出上限、上下文窗口、最大输入、超时、重试、温度、`search_mode`、`structured_output_mode`、`wire_options`）。字段与类型从 `GET /models` 返回的 `profile_schema` 渲染，**不在前端硬编码枚举**。
- 「用途」页：

```
對話與工作        [ deepseek-chat ▾ ]        需要：工具
記憶擷取          [ deepseek-chat ▾ ]
自我反思          [ deepseek-reasoner ▾ ]
記憶夢境整理      [ deepseek-reasoner ▾ ]
插件 Agent        [ deepseek-chat ▾ ]        需要：工具
結構化小任務      [ deepseek-chat ▾ ]
─────────────
聯網搜尋          [ 模型搜尋 ▾ ]  連接 [ claude-search ▾ ]   / Tavily 金鑰 [______]
參與判斷          [ jev ▾ ]  請求模型 [____]  （沿用現有 semantic 欄位）
記憶向量          [ 阿里雲 Embedding ▾ ]  維度 1024   ⚠ 更換會建立新索引並重新計算
圖片理解          [ qwen3.7-plus ▾ ]
語音轉文字        [ qwen3-asr-flash ▾ ]
```
  下拉只列满足 `required_capabilities` 的 profile（例如"對話與工作"只列有 `tools` 的）；能力要求来自 B（B-3 返回每个 task 的要求），不在前端写死。
- 「用量」页：`stats_by_task` / `stats_by_profile`（B-6），只读。
- 页面顶部显示 `apply_mode`（`hot_reload` → "即時生效"；`restart` → "儲存後需重新啟動 Yuki"）与 `matches_loaded=false` 时的提示"磁碟上的設定與執行中的不一致"。
- **非超管**：整个分类只读，顶部说明"只有 Yuki 的管理員可以修改模型"，仍显示当前对话模型名称（来自 `/client/v1/meta` 或 `/me` 已有字段，若没有则 B-1 的 GET 对非超管返回 403，页面显示说明即可，不额外造接口）。
- **本机部署表单**（`LocalBot.tsx`）复用"新增連接"的同一组件，部署完成后直接进入"模型"页补配其他用途。

### 3.4 原 owner 权限全部归 Person 超管（已确定）

“全部迁移”指原 character owner 的整套权限；不改变个人数据、本人电脑和原执行的真实归属。本文删除的 owner 专指这套角色资格，其他资源的 owner 字段与真实所有权不作同名删除。

| 范围 | 超管 | 普通有效配对使用者 |
| --- | --- | --- |
| Yuki 名称、简介、头像 | 可修改、上传、清除及恢复默认头像 | 可查看公开展示资料，不能修改 |
| 人格 SOUL 原文、编辑、保存、重新载入及管理变更提示 | 可读取和修改，沿原文件 CAS 与发布链 | 不能通过管理接口读取原文或修改；正常与 Yuki 聊天不受影响 |
| 服务器上 Yuki 的共享电脑：详细环境、画面/截图、浏览器 tabs、相关 Work 投影、文件列表/下载、唤醒/休眠、控制租约接手/归还/转交 | 可按现有接口使用，仍核真实租约、文件/Work 范围及原操作回执 | 不再因配对获得这些原 owner 权限；普通公开可用性提示不包含受限详情 |
| SELF 安排列表读取 | 可查看现有 SELF 列表 | 不提供原 owner 专属列表；本人安排仍正常查看 |
| 模型、Provider、密钥及用途配置 | 沿 B-1 的现有管理能力读写 | 沿现有读权限呈现公开模型信息，不获取完整配置或密钥 |

旧 owner 没有授予的权限不因本轮扩大：SELF 安排的修改/暂停/删除、他人的安排、私有记忆、Work、产物和本机 Connector 仍沿各自现行授权。超管不因此自动获得其他人的电脑；服务器共享电脑也不是某个用户的本机 Connector。

Person 是唯一人物管理权源。账号转移不携带资格，解绑或换平台不删除资格；设备撤销、原 Person 与当前人物有效性、显式撤权沿既有共同身份规则核验。不得从昵称、QQ 账号、旧 owner、首个 Person、设备标签或配对先后推断超管。

删除 owner 的活跃模型/辅助函数、授予入口、CLI/UI 文案、`viewer.is_owner` 与硬编码 `is_owner=true` 投影；现有 main 已删除的部分保持删除。历史迁移、已发生的授权记录和原回执保留原事实，不再参与新授权、不改写为超管记录；旧 `owner_required` 只可作为原失败回执展示，不再作为新请求的授权结果。

---

## 第 4 章 后端施工（B）

> 每个任务一个 PR，按顺序。分支名 `codex/model-config-<主题>-<日期>`。施工前读 B 的 `docs/architecture/development-contract.md`、`admin-api.md`、`model-providers.md`。

### B-0 退役 owner 残留，原权限统一到 Person 超管

**根因**：旧 `require_character_owner()` 只查独立授权行，不看 Person 超管；即使 Desktop 确实绑定同一超管 Person，也可能被拒。此前删除 owner 的方向保留，现按 3.4 统一权限，而非恢复那张授权表。

**步骤**
1. 复用 `ControlAccess.principal_for_person()` 与现行共同身份解析，在客户端、管理接口和领域执行处使用同一 Person 超管事实。将现有 `control.character.read`、`control.character.mutate` 纳入 `SUPERUSER_CAPABILITIES`，不新建 owner/管理员存储或第二套角色解析。
2. 在 3.4 的原 owner 入口统一核超管：`character/repository.py` 的共享资料写入、`avatar.py` 的头像变更、`soul.py` 的原文读写/重载、`client_api/computer.py`/`computer_commands.py` 的共享电脑与文件、`automations.py` 的 `scope=self` 列表。名称/头像公开读取仍沿当前展示接口；同一领域入口不能因走 client/admin 路由而得出矛盾权限。
3. 保留头像收流前/提交前、电脑效果派发前、文件下载继续读取、display ticket 兑换与活跃 RFB 收发时已有的复核位置，用当前超管事实替换资格判断。复用现有 `_authority_changed`，撤权后关闭原屏幕流、停止新的受限操作并归还原人工租约；原回执、已发生效果、原租约归还/清理沿原身份与操作 ID 收敛，不因撤权遗留无法释放的租约，不重发未知结果。
4. 在现有 `/client/v1/me` 返回 `is_superuser`，由同一权限解析生成当前事实，供 D 呈现；不保存设备角色副本。移除 live character 响应、SSE 和客户端合同里的 `is_owner`；SOUL revision 等管理变更提示仅向有权者投影，不能再硬编码 true。沿现有身份/变更同步使撤权后的 UI 更新，后端执行核验为准。
5. 核对并删除活跃 owner 函数、ORM 使用、路由、CLI、部署输入和提示文案残留。`owner_request_id` 等旧输入在合同及调用方同步后退出，不用兼容分支恢复授权。历史授权行、冻结迁移和原失败回执只保留历史用途；不自动升级任何旧 owner 为超管。
6. 同步 B 的 `development-contract.md`、`client-api.md`、`admin-api.md`、SOUL/共享电脑/本机部署现行说明，将“有效配对即可管理共享功能”改为 3.4；历史日期任务书及旧验收保留当时事实。导出更新后的个人/管理 OpenAPI，按现行版本规则更新合同，供 D-0/D-1 消费。

**先列验收场景，再施工**：至少覆盖“既有超管首次 Desktop 登录即可编辑”“同人多个 Desktop 均能正确识别”“普通配对者不能修改”“旧 owner 非超管仍拒绝”“仅绑定变化不丢失人物资格”“真实撤权后停止新管理效果”“没有变更本人 Connector/安排的权限”。全部在隔离服务与测试资料完成，不操作真实 profile、Connector 或生产电脑。

### B-1 管理路由接受超管人物的个人设备

**为什么**：解决 C1，且不复制路由。与 B-0 共用 Person 超管解析；超管已映射到 `control.config.file.*`，B-0 同时补齐原 owner 对应的资料管理能力。

**步骤**
1. `src/yuki/admin_api/http.py` 的 `principal()`：当前只调用 `resolve().access.authenticate(credential, source=PrincipalSource.CLI)`。改为：operator 认证失败（`UNAUTHENTICATED`）时，用**个人设备 token 的现有校验**（client API 的设备凭据解析，在 `src/yuki/client_api/identity.py` 一带，按现有函数名查找）得到当前 Person，再调 `ControlAccess.principal_for_person(person_id)`（`src/yuki/admin/control_resolution.py`），得到 `USER_CAPABILITIES` 或 `SUPERUSER_CAPABILITIES`。
2. 只接受 `purpose = chat` 的设备凭据；connector 凭据不接受（它不是用户登录）。
3. `PrincipalSource` 若需要区分来源，复用已有枚举值；**没有合适值时停下报告**，不要随意新增。
4. 能力仍逐项 `authorize(actor, "...")`：非超管人物调用 `/models` 自然得到 403。
5. 文档：`admin-api.md` "身份与权限"补一段："超管人物的个人聊天设备可用其 token 调用管理 API，能力等于 `SUPERUSER_CAPABILITIES`；它不是 operator 凭据，不获得 operator 独有能力。" 同时删掉 `client-api.md` 中与此矛盾的"个人 token 不替代 operator 控制凭据"的歧义表述，改为准确说法。
6. 这条通路适用于已有超管，不要求重新配对、另授 owner 或先去 QQ 领取 operator token；设备 token 不直接变成 operator 凭据。各入口仍核原来源与当前 Person，不能只让模型页放行、资料和共享电脑仍因凭据类型拒绝同一超管。

**不许**：在 client API 下复制 models 路由；给设备 token 授予 operator 能力；为非超管放宽能力。

**本次用户已明确授权施工**（在 PR 描述中说明边界）：这是授权面变化——超管人物的设备 token 泄露等同于该人物的管理权限，与"QQ 超管账号可执行 `/ai admin`"等价。本次沿已有 Person 超管事实实施，不重复索取确认，不增加 operator 独有能力。

### B-2 本机部署的人物授予超管

**步骤**：`src/yuki/deployment_setup/desktop.py` `pair()` 在创建（或读取）Person 后、签发配对码前，调用现有 `persons/{id}/superuser/grant`（admin client 已有 `mutate`/`identity_mutation` 辅助），使用新的 `superuser_request_id: UUID`（加进 `DesktopPairing`，必填，D 端传入）。保持原请求 UUID 幂等。

**不许**：在远端服务器的配对流程里自动授超管（只限本机部署这条 `desktop-pair` 命令）。

已有超管 Person 直接沿原资格工作。远端部署仍由可信 operator 明确选择和授予 Person，普通 `/ai link`、重连、改服务器地址、转移账号或旧 owner 授权都不自动增删超管；不得把“第一个创建的人物”当作部署者证明。

### B-3 模型目录元数据：Provider 预设与用途要求

在 `ConfigFileService._read_snapshot()` 的返回里追加两个**只读、不写入 TOML** 的字段（与已有 `semantic_providers` 同类）：

1. `provider_presets`：列表，每项 `{provider, display_name, protocol, default_base_url, api_key_env_suggestion, docs_url, supports_model_listing}`。数据来源：`vendor_policy.py` 已有的供应商方言 + `model-providers.md` 表格中的官方地址。新建一个模块级常量（例如 `src/yuki/model_runtime/provider_presets.py`），**这是唯一的预设来源**，安装向导（`deployment_setup/service.py` 中已有的预设选择）也改为读它，删掉向导里重复的表。
2. `task_requirements`：`{task: [capability,...]}`，直接由 `profiles.py` 的 `_DEFAULT_REQUIREMENTS` 生成。另附非 route 用途：`embedding`、`vision`（`image_input`）、`asr`、`search`。

### B-4 Embedding 进入 bundle，并支持 OpenAI 兼容端点

**步骤**
1. `profiles.py` 的 `_ProfileDocument` 增加可选 `embedding: dict | None`；`ModelProfileCatalog` 增加 `embedding: EmbeddingConnection | None`（新的 frozen pydantic 模型，字段见 3.2）。
2. `src/yuki/memory/embedding/runtime.py`（或现行装配处）：catalog 有 `embedding` 段时用它构造 provider；没有时沿用 `Settings.memory_embedding_*`（过渡，见 B-7）。
3. 新增 `src/yuki/memory/embedding/openai_compatible.py`：`POST {base_url}/embeddings`，`{model, input, dimensions?}`，解析 `data[].embedding`。行为与 `qwen.py` 对齐：一次请求、超时与重试沿配置、错误类别不含正文。这是**唯一允许新增的 provider 实现**。
4. profile 指纹（`memory_embedding_profiles`）已经由 provider/端点/模型/维度等生成——换配置自然生成新 profile、旧向量隔离，**不要写迁移或删除旧向量**。
5. `ConfigFileService.save()` 热应用时同步切换 embedding runtime；已在进行的嵌入任务按原 profile 完成。若热切换实现成本过高，`apply_mode` 对该段如实返回 `restart`，不要伪装热应用。
6. 文档 `memory-v2-embedding.md` "DashScope API Key 仅通过 `MEMORY_EMBEDDING_API_KEY` 读取"改为现行说法。

### B-5 视觉、语音转写、Tavily Key 进入 bundle

同 B-4 的模式：`vision`、`asr`、`search` 三个可选段；装配处"段存在则用段，否则用现行 Settings/运行时覆盖"。运行时覆盖中**模型身份类**键（`vision.base_url`、`vision.model`、`vision.api_key`、`asr.api_key`、`asr.protocol`、`web.tavily_api_key`）在段存在时不再生效；行为类键（并发、限流、帧数、超时、保留天数）继续生效。

### B-6 测试连接、获取模型列表、用量

在 `/admin/v1` 增加三个路由（与现有 `/models` 同文件、同授权风格）：

| 路由 | 能力 | 行为 |
| --- | --- | --- |
| `POST /models/test {profile_id}` 或 `{draft_profile, api_key?}` | `control.config.file.mutate` | 用现有 `ModelClientPool` 构造客户端，发一次最小真实请求（`max_output_tokens` 取 1–16，不带工具）。返回 `{ok, latency_seconds, error_category}`；`error_category` 复用现有 `llm/http_errors.py` 分类（认证、限流、额度、超时、协议）。**不写 `model_invocations`、不进 Work 预算、不重试** |
| `POST /models/discover {profile_id}` 或 `{draft_connection, api_key?}` | 同上 | 按协议调用上游模型列表：OpenAI 兼容 `GET {base}/models`、Anthropic `GET /v1/models`、Gemini `models.list`。返回 `[{id, display_name?}]`，原样，不按名称推断能力。上游不支持时返回 `unsupported` |
| `GET /models/stats` | `control.config.file.content.read` | 返回 `stats_by_task()` 与 `stats_by_profile()`（`model_runtime/repository.py` 已有） |

草稿模式允许"保存前先测试"；草稿里的 `api_key` 只用于本次请求，**不落盘、不进日志、不进审计**。

### B-7 退役重叠的旧配置（在 B-4/B-5 上线并迁移后做）

1. 运行时覆盖中的 `llm.model`、`llm.api_key`、`llm.temperature`、`llm.max_output_tokens`、`llm.timeout_seconds`、`llm.max_retries`、`llm.thinking_enabled`：确认现行读取者（`grep -rn "llm_model\|llm_temperature" src`）。如果它们已经只是 profile 的 env 引用值或无人读取，**删除这些 spec 及下游读取、文档、测试**；若仍有真实读取者，列出来报告，不要硬删。
2. `MEMORY_EMBEDDING_*`、`VISION_*`、`ASR_*` 模型身份类环境变量：保留到"所有已知部署都写入了新段"为止。写一个**一次性**迁移命令 `yuki admin model migrate-legacy`：读取当前生效值，生成对应段并写入 sidecar（密钥），用同一个 `ConfigFileService.save()`。迁移完成后的下一个版本删除旧读取路径。退出条件写进 `docs/upgrade-*.md`。

### B 的验收

- B-0 单独做真实 HTTP + 现有电脑 Manager 测试边界的 E2E：既有超管使用个人设备 token 完成名称修改、测试头像上传/清除/恢复、SOUL 读取/保存/重载；核对原 revision、请求 UUID 和受影响的共享资料。普通 Person 及只有旧 owner 历史行的 Person 对同一写操作得到 403，资料保持不变，公开名称/头像仍可展示。产物包含脱敏请求/响应、前后 revision 与头像摘要。
- B-0 逐项验证共享电脑详情、文件、display ticket/RFB、唤醒/休眠及租约控制、SELF 列表的超管成功与普通用户拒绝；不经真实生产电脑。超管撤权后的新调用/新输入被拒，原操作回执和租约释放按原事实收敛。原本人安排和本机 Connector 归属断言保留，不能借超管迁移扩大跨人访问。
- 每个 PR 执行 B 仓库要求的 lint/type/test 子集及与改动对应的真实 HTTP E2E，不要求前置 PR 调用尚未实现的路由。模型功能合入后，在隔离 Bot（`tests/support/desktop_reference_server` 一类现有夹具）完成整条验收：超管人物设备 token 依次 `GET /models` → `discover` → `test` → `apply`（含 `embedding` 段）→ 再 `GET` 核对 `revision` 变化、`saved_api_key_profiles` 含新别名、响应中**任何位置**都不含 Key 明文（对响应 JSON 做全文检索断言）。产物：请求/响应（脱敏后）JSON。
- 非超管设备 token 调用 `/models` 得到 403。
- connector 用途 token 调用得到 401。

---

## 第 5 章 桌面端施工（D）

> 前置：B-0 后可做 D-0；B-1、B-3 已合并且合同更新后做 D-1 起的模型页面；B-6 合并后才做 D-4 的测试/清单按钮。D 的 UI 布局任务书（`Yuki-Desktop-UI布局与设置重整任务书-2026-10-30.md`）的 PR-2（设置外壳与分类）应先完成；若尚未完成，本任务的 `models` 分类先按现有分类结构加在"Yuki 連接"之后，等 PR-2 再迁移。

### D-0 以当前人物超管呈现共享管理功能

1. 更新 B-0 的个人 API 合同、生成类型、`shared/sync.ts` 与相关视图；从 B-0 新增到现有 `/me` 的 `is_superuser` 字段读取事实，删除 `viewer.is_owner`、SSE `is_owner` 和角色 owner 文案。头像/名字/人格编辑器、服务器电脑视图与控制、SELF 列表按 3.4 呈现；不另做设备管理员状态或权限配置页。
2. 已绑定超管的 Desktop 首次登录即可编辑名称/头像/人格，不要求重配对或另授角色。普通用户仍看公开资料和正常聊天；编辑入口说明“只有 Yuki 的管理員可以修改”，共享电脑与 SELF 管理区域说明当前缺少权限。直接 HTTP 调用仍由 B 拒绝，不能只靠按钮禁用。
3. 本人安排、Work、附件和本机 Connector 页面继续按各自真实权限工作，不因非超管整页封禁。现有 UI 不显示“超管”或“角色拥有者”，统一称“管理員”；真实权限变化及后端 403 用当前事实更新页面。

### D-1 管理 API 合同与主进程桥

1. 合同：在 D 增加 `contracts/admin-api.openapi.json`（从 B 导出，方式参照现有 `build-tools/check-contract.mjs` 与 `contracts/source.json`；`source.json` 增加 admin 合同的来源与 sha256）。`npm run generate:contract` 扩展生成 `src/shared/admin-contract.gen.ts`。
2. 主进程：`src/main/api/client.ts` 已有对 `/client/v1` 的带 token 请求封装。**复用同一封装**，增加对 `/admin/v1/models*` 的方法（同一设备 token、同一错误映射 `ApiError`），不要新建 HTTP 客户端。
3. preload / `src/shared/desktop.ts` 的 `ConversationBridge` 增加：
   ```ts
   models: {
     read(characterId: string): Promise<ApiReply<ModelBundle>>
     apply(characterId: string, input: { requestId: string; expectedRevision: number; document: ModelDocument; apiKeys?: Record<string, string> }): Promise<ApiReply<ControlResult>>
     test(characterId: string, input: ModelTestInput): Promise<ApiReply<ModelTestResult>>
     discover(characterId: string, input: ModelDiscoverInput): Promise<ApiReply<{ models: { id: string; display_name?: string }[] }>>
     stats(characterId: string): Promise<ApiReply<ModelStatsView>>
   }
   ```
   类型从生成的合同导入，不手写。
4. `apiKeys` 只经过 preload → main → HTTP，**不进 renderer 状态以外的任何地方**（不写 electron-store、不写日志、不写诊断导出）。renderer 里保存成功后立即清空输入框 state。
5. request UUID：apply 前 `crypto.randomUUID()`，保存在组件 state；HTTP 失败/超时时用**同一 UUID**重试由用户点击"重新確認"触发（复用 UI 任务书的 `PendingRequest` 组件）。

### D-2 「模型」分类骨架

1. `Settings.tsx` 增加分类 `{ id: 'models', label: '模型', icon: Cpu }`（放在"當前 Yuki"组，"連線"之后）。
2. 新文件 `src/renderer/views/ModelSettings.tsx`：一个 `useQuery(['desktop','models',characterId], read)`；顶部 Segmented `連接 / 用途 / 用量`；顶部右侧 `apply_mode` 文案。
3. 403 → 只读说明（见 3.3）；`valid=false` → Banner"Yuki 上的模型設定檔無法解析，請由管理員檢查"（不显示解析错误详情，后端本就不回传）。
4. 所有修改共用一个 `save(nextDocument, apiKeys?)`：带 `expectedRevision = data.revision`；成功后 `invalidateQueries`；`version_conflict` → Banner"設定已在其他地方變更" + [重新載入]。点击后直接重新读取（不加确认框），用户刚填写、尚未保存的金鑰输入框内容保留不动。

### D-3 「連接」页

1. 分组：`groupBy(profiles, p => [p.provider, p.protocol, p.base_url, p.api_key_env].join('|'))`。卡片标题：预设的 `display_name`（按 `provider` 在 `provider_presets` 里查；查不到用 `provider` 原值），右侧 base_url 主机名、金鑰状态（`saved_api_key_profiles` 含其任一 profile → "已儲存"；`api_key_env === ''` → "無需金鑰"；否则 → "來自環境變數"）。
2. 每行：profile id、模型 ID、能力标签（`capabilities` 映射为 `對話`(tools) `圖片`(image_input) `思考`(reasoning) `結構化`(structured_output) `原生搜尋`(native_web_search) `長上下文`(long_context)），`[測試]`、`[編輯]`。
3. 「新增連接」Sheet（两步）：
   - 第 1 步：预设网格/列表（来自 `provider_presets`）+ 三个"自訂"项 + "本機（Ollama / LM Studio）"（= `openai_compatible` + `http://localhost:11434/v1` 等地址由 B 预设提供）。
   - 第 2 步：连接名称（默认 `display_name`）、地址（预填）、金鑰（password 输入，可空）、`[測試連接]`（需要至少一个模型 ID：先让用户填或点 `[取得模型清單]` 选一个）→ 勾选要加入的模型 → `[儲存]`。
   - 保存时为每个勾选模型生成 profile：`id = slug(連接名稱)-slug(模型ID)`（冲突时追加 `-2`），字段取预设默认 + 用户输入；`api_key_env = 'YUKI_KEY_' + SLUG(連接名稱)`（合法环境变量名），金鑰放进 `apiKeys`。**`timeout_seconds`、`max_retries`、`default_temperature`、`default_max_output_tokens` 等必填字段取 `profile_schema` 的默认值；schema 没有默认值的必填字段在"進階"里要求用户填写**，不要前端自造默认。
4. 删除连接/模型：若被任何 route、`search_connection`、`embedding`/`vision`/`asr` 引用，按钮禁用并提示"仍被「X」使用"；否则确认后删除（允许的确认之一）。
5. 「編輯」Sheet：按 `profile_schema` 渲染字段（enum → select，boolean → Toggle，integer/number → number 输入，可空字段提供"未設定"）。`headers` 不显示（后端不回传、不接受）。`wire_options` 放在"進階"折叠里，按 schema 渲染。

### D-4 测试与模型清单

1. `[測試]`：调 `models.test({profile_id})`；结果行内显示"可用 · 0.8 秒"或分类错误文案（建立一个 `error_category → 文案` 映射表，类别以 B 返回为准，未知类别显示原类别字符串）。
2. `[取得模型清單]`：调 `models.discover`；结果以可搜索的勾选列表显示上游**原始模型 ID**；`unsupported` → "這個服務不提供模型清單，請手動輸入模型 ID"。
3. 两者都不自动保存任何东西。

### D-5 「用途」页

1. 六个 route：每行一个 select，选项 = 满足 `task_requirements[task]` 的 profiles。改动即保存（`document.routes[task] = id`）。
2. 聯網搜尋：`search_backend` Segmented（`模型搜尋` / `Tavily`）；模型搜尋时选 `search_connection`；Tavily 时显示金鑰输入（写入 `search.tavily_api_key_env` 对应 sidecar 别名）。每个 profile 的 `search_mode` 在"編輯"里改，这里不重复。
3. 參與判斷：渲染现有 `semantic_observation` 段（`route` + `connections`），provider 选项来自 `semantic_providers`，必填项来自其 `required`。
4. 記憶向量：provider（`qwen_dashscope` / `openai_compatible`，来自 B 预设中 `supports_embedding` 的项）、地址、金鑰、模型、维度；修改时弹出**唯一一次确认**："更換後會建立新的向量索引並重新計算所有記憶的向量，期間語義搜尋會暫時只用關鍵字。舊索引保留，不會刪除。"
5. 圖片理解、語音轉文字：选择一个已有连接（地址/金鑰/模型取自所选 profile 的连接字段，写入对应段并设 `enabled=true`）或"不使用"（保存原段的 `enabled=false`，不退回旧设置）。記憶向量同样按该段的 enabled 事实启停；改好配置并启用时写 `enabled=true`。

### D-6 「用量」页

`models.stats`：两个表（按用途、按模型）：调用次数、成功/失败、平均延迟、输入/输出 token、缓存 token、未知用量次数。只读，无图表。

### D-7 本机部署表单复用

`LocalBot.tsx` 的协议/地址/模型/Key 四个字段替换为 D-3 的"新增連接"第 2 步组件（预设来源：部署前没有后端可读，**使用随包镜像里的同一份预设**——由 `src/main/local-bot.ts` 在部署前执行镜像内 `yuki setup provider-presets --json` 读取；若该命令不存在，B-3 PR 一并加上，输出与 `provider_presets` 相同）。部署成功并配对后，自动打开"設定 → 模型 → 用途"。同时向 `desktop-pair` 传入 B-2 的 `superuser_request_id`。

### D 的验收

- `npm run lint`、`npm run typecheck`。
- D-0 E2E 使用已存在的超管 Person 正常配对：首次进入即修改名称、头像和人格，另一个同人 Desktop 正确识别资格并看到共享变更；普通 Person 看到公开资料但不能编辑或进入受限共享电脑/SELF 管理。检查普通用户仍可用本人安排与 Connector；不要求另授 owner、不出现 owner 文案。产物：各身份截图及去敏权限/请求 JSON。全部自动测试窗口使用 `YUKI_E2E_BACKGROUND_WINDOWS=1`，不覆盖真人资料或抢占前台。
- 新增 `tests/e2e/model-settings.spec.ts`（用 B 的隔离参考服务；该服务需支持 B-1/B-6 路由，B PR 中一并补齐夹具）：
  1. 超管人物配对 → 打开"模型" → 截图三页。
  2. 新增一个"自訂（OpenAI 相容）"连接指向参考服务的假模型端点 → 测试成功 → 取得清单 → 勾选两个 → 保存 → 卡片出现两行，金鑰显示"已儲存"。
  3. 用途页把"記憶擷取"切到第二个模型 → `GET /models` 核对 `routes.memory_extraction`。
  4. 修改记忆向量 → 出现确认 → 确认后核对 `embedding` 段写入。
  5. 非超管人物配对 → 页面只读。
  6. 全程抓取 renderer 可见文本与主进程日志，断言不含测试 Key 明文。
  产物：`model-settings-*.png`、`model-settings.json`（保存的文档摘要，去掉 Key）。

---

## 第 6 章 顺序与里程碑

1. **B-0 → D-0**（删除 owner 残留、原权限归超管，先修复“本人已是超管却无法在 Desktop 管理”的链路）
2. **B-1 → B-2 → B-3**（管理 API 凭据接入、可信本机部署授予与元数据）
3. **D-1 → D-2 → D-3 → D-5（仅六个 route 与搜索）**
4. **B-6 → D-4 → D-6**
5. **B-4 → B-5 → D-5（向量、图片、语音）→ D-7**
6. **B-7**（迁移命令上线、所有部署迁移后删除旧路径）

## 第 7 章 本轮不做

- 多 Key 轮询、模型 fallback 链（OpenClaw/Cherry 有，但 Yuki 现行合同"不按失败隐式换模型"——这是产品决策，需用户另行决定）。
- OAuth/订阅登录（Hermes、OpenClaw 支持）。
- TTS（Genie-TTS 是独立 worker，不是 LLM Provider；另行调研后再定）。
- 按人物/群覆盖模型（AnythingLLM 的"每个工作区不同 LLM"）——Yuki 是一个永久主体，暂不需要。
