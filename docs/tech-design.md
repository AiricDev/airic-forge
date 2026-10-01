# Airic Forge 后端系统技术方案

## Overview

本方案描述 Airic Forge 后端的完整技术架构。系统以 Docker 镜像交付，对外提供 Web 工作台 API、可嵌入业务 App 的 Copilot 通道、Agent 运行服务与 Operating Model（OM）版本治理能力。

后端需要同时承担四类职责：

* 运行 Work Agent：在业务 App 页面内执行用户任务，调用已授权的 Command API，并记录可追溯轨迹。
* 运行 Reflection Agent：基于单个 Work 的轨迹进行多轮对话，并持续维护该 Reflection 的 Proposal。
* 管理 OM 版本：以 Git 为唯一事实来源，commit 即采纳；支持多个并行 Proposal。
* 管理运行数据：用户、Work、Reflection、Proposal 元数据、能力目录，以及指向轨迹文件的位置引用。

技术选型的既定约束：Node.js + pnpm 开发后端；使用 pi-sdk 实现系统内各类 agent 能力；通过 ACP 协议对接 App 内嵌 Copilot 以及 Web 工作台内的 Reflection 对话。其余选型为本方案提出的建议。

Accountable role: Unknown。

指标基线：Unknown。指标目标：Unknown。

研究证据：Unknown。完成证据：Unknown。

## Tech Stack

### 语言与运行时

| 层面 | 选择 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js 24 LTS | 与 pi-sdk 的 Node/TypeScript 接口一致，长期支持版本 |
| 语言 | TypeScript 7.x，strict 模式 | 契约类型与 schema 校验可共享 |
| 包管理 | pnpm workspace | 约定要求；monorepo 内部包边界清晰，安装体积小 |
| 进程管理 | 单 Node 进程 + 内部任务调度 | 首版单实例部署，避免引入外部队列中间件 |

### 主要依赖（Proposed）

| 用途 | 选择 | 理由 |
| --- | --- | --- |
| HTTP 框架 | Fastify | 高性能、schema 驱动、插件体系适合契约化 API |
| WebSocket | `@fastify/websocket` | ACP over WebSocket 的传输层 |
| Agent 内核 | `@earendil-works/pi-coding-agent`（pi-sdk） | 约定要求；提供 `createAgentSession`、工具注入、会话持久化 |
| ACP 类型 | ACP TypeScript SDK / JSON Schema | 直接复用官方 v1 wire 类型，避免自造协议 |
| 数据库 | SQLite（WAL 模式） | 单实例部署、随 `/data` 备份恢复、无额外服务依赖 |
| ORM / 迁移 | Drizzle ORM + drizzle-kit | 类型安全、迁移文件可随镜像发布 |
| Git 操作 | `simple-git` + 受控 `git` CLI 调用 | worktree、分支、commit trailer 操作需要原生 CLI 能力 |
| 校验 | Zod | 请求体、OpenAPI 能力契约、`work.yml` manifest 校验 |
| OpenAPI 解析 | `@apidevtools/swagger-parser` | 解析 App 发布的 Agent 专用 OpenAPI 文档 |
| 日志 | pino | 结构化日志，便于事件与轨迹关联 |
| 测试 | Vitest + 临时仓库夹具 | 单元与集成测试；Git 与轨迹文件行为使用夹具验证 |

### Monorepo 结构（Proposed）

```text
airic-forge/
  packages/
    core-domain/     # 领域模型、状态机、类型与 Zod schema
    db/              # Drizzle schema、迁移、仓储层
    trajectory/      # 轨迹文件读写、分段、索引与检索
    git-om/          # OM 仓库、分支、worktree、commit trailer
    acp-server/      # ACP JSON-RPC 服务端与会话桥接
    agents/          # pi-sdk 封装：Work Agent、Reflection Agent、工具注入
    capability/      # OpenAPI 导入、能力目录、Command API 客户端
    api/             # Fastify 路由、鉴权、权限判定
    app/             # 组装入口，单进程启动
  web/               # Web 工作台前端（独立构建，静态托管）
  docker/

```

## System Architecture

### 分层视图

```text
业务 App 前端（Copilot 面板）        Airic Web 工作台
        │ ACP over WebSocket              │ HTTPS + ACP over WebSocket
        ▼                                 ▼
┌─────────────────────────────────────────────────────┐
│ API / ACP 接入层 (Fastify)                          │
│  - 身份解析、权限判定、请求校验                      │
│  - ACP session 路由（Work / Reflection）             │
├─────────────────────────────────────────────────────┤
│ 应用服务层                                           │
│  WorkService | ReflectionService | ProposalService    │
│  OMVersionService | CapabilityService | TrajectoryLog │
├─────────────────────────────────────────────────────┤
│ Agent 运行层 (pi-sdk)                                │
│  WorkAgentRunner | ReflectionAgentRunner              │
│  工具注入、上下文组装、事件流                         │
├─────────────────────────────────────────────────────┤
│ 存储与外部系统                                        │
│  /project Git 仓库 | /data SQLite + 轨迹文件          │
│  业务 App：身份接口、页面上下文接口、Command API      │
└─────────────────────────────────────────────────────┘

```

### 运行单元与职责

* WorkService：解析 Work 上下文，锁定本轮 OM commit，驱动一轮执行，并将 Turn、动作与 App 回执写入该 Work 的轨迹文件。
* ReflectionService：保证 Work 与 Reflection 一对一；管理对话、lens 切换、Proposal 生命周期。
* ProposalService：管理 Proposal 分支、worktree 租约、采纳与放弃。
* OMVersionService：封装 Git 读写；对外只暴露 commit SHA、文件树与 diff。
* CapabilityService：导入、比较并接受能力目录；向 Work Agent 暴露已授权工具。
* TrajectoryLog：以追加写方式维护轨迹文件，提供按 Turn、动作与时间范围的读取接口。

### Agent 运行模型（pi-sdk）

两类 agent 共用 pi-sdk 的 `createAgentSession`，差异在 cwd、工具集与系统提示：

| 维度 | Work Agent | Reflection Agent |
| --- | --- | --- |
| 触发 | App 内 Copilot 的用户消息 | Web 工作台中该 Work 的 Reflection 对话 |
| cwd | 只读 OM 快照目录（按 Turn commit materialize） | 该 Proposal 的专属 worktree |
| 工具 | 已接受目录中、且 `work.yml` 明确允许的 Command API | Proposal worktree 内的文件读写与 diff |
| 输出 | 消息、tool call、命令回执引用 | 对话消息 + 持续更新的 Proposal 文件变更 |
| 业务副作用 | 有（经 App 校验） | 无；仅修改候选分支文件 |

关键约束：Work Agent 不得写 `/project`；Reflection Agent 不得调用业务 Command API。两者的工具注册表在启动 session 时由服务端构造，不接受来自模型输出的工具扩展。

会话持久化：pi-sdk 的会话历史以 JSONL 存储于 `/data/agent-sessions/`；产品级轨迹由 TrajectoryLog 单独写入轨迹文件，用于展示、权限过滤与 Reflection 证据检索。轨迹只记录可观察事件，不记录模型私有推理。

## Data Model

Git 保存 OM 内容与版本；轨迹文件保存 Work 的执行过程；SQLite 只保存实体元数据与指向 Git commit、轨迹文件的引用，不重复存放正文内容。

### 轨迹文件

* 位置：`/data/trajectories/{workId}/`，按追加写的 JSONL 分段文件组织，例如 `segment-0001.jsonl`。
* 内容：Turn 开始与结束、固定的 OM commit、用户与 Agent 消息、页面上下文快照引用、动作请求与 App 命令回执、错误与恢复记录。
* 读取：按偏移量与分段顺序读取；Reflection 证据与工作台轨迹视图均从该文件生成。
* 数据库不存 Turn、事件与动作明细，只记录该 Work 的轨迹目录、当前分段与写入游标。

### 核心表（Proposed）

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `users` | `id`、`email`、`role`、`active_branch`、`created_at` | Email 来自 App 身份接口；`role` 为 user/admin |
| `works` | `id`、`user_id`、`work_type`、`entity_id`、`status`、`wd_package`、`om_commit_latest`、`trajectory_path`、`trajectory_segment`、`trajectory_offset`、`last_activity_at` | Work 是唯一工作主体；轨迹内容在文件中，表内仅存位置与游标 |
| `reflections` | `id`、`work_id`(unique)、`lens`、`status`、`transcript_path`、`created_at`、`updated_at` | 与 Work 一对一；对话正文同样以文件保存 |
| `proposals` | `id`、`reflection_id`、`branch_ref`、`base_commit`、`state`、`adopted_commit`、`updated_at` | state: open/adopted/abandoned；OM 变更内容在 Git 中 |
| `worktree_leases` | `id`、`proposal_id`、`path`、`holder`、`acquired_at`、`expires_at` | 支撑 worktree 按需创建与回收 |
| `capability_catalogs` | `id`、`version`、`status`、`spec_hash`、`accepted_by`、`accepted_at` | 仅 accepted 目录进入运行时 |
| `capabilities` | `id`、`catalog_id`、`operation_id`、`schema_json`、`change_type` | 供 WD 授权与工具注入 |

### 关系要点

* `works` 1—1 `reflections`；`reflections` 1—0..1 活跃 `proposals`，并保留历史 proposal 记录。
* Turn、事件、动作与命令回执不建表，全部保存在该 Work 的轨迹文件中，通过 `works.trajectory_path` 定位。
* API 能力建议不单独建表，它是 Reflection 的一类结果：仅供阅读的建议写入 Reflection 对话记录；需要落入 OM 的内容由 Proposal 的文件变更承载。
* Proposal 的 OM 变更内容不入库，仅保留 `branch_ref`、`base_commit` 与按需生成的 diff。

### 索引（Proposed）

* `works(user_id, status)`、`works(work_type, entity_id)`、`works(last_activity_at)`
* `reflections(work_id)` 唯一索引
* `proposals(reflection_id, state)`、`worktree_leases(expires_at)`
* `capability_catalogs(status, version)`

## API Design

### 约定

* REST 风格 JSON API，路径前缀 `/api/v1`。
* 写操作要求幂等键或乐观并发字段。
* 所有响应包含 `requestId`，与结构化日志、轨迹记录关联。

### 主要端点（Proposed）

| 方法与路径 | 用途 |
| --- | --- |
| `POST /api/v1/sessions/bootstrap` | 用 App Access Token 解析用户，必要时创建用户、active 分支 |
| `GET /api/v1/works` | 列出当前角色可访问的 Work |
| `GET /api/v1/works/{workId}` | Work 详情与元数据 |
| `GET /api/v1/works/{workId}/trajectory` | 按游标分页读取轨迹文件中的 Turn、动作与回执 |
| `POST /api/v1/works/{workId}/reflection` | 打开或创建该 Work 的唯一 Reflection |
| `GET /api/v1/reflections/{id}` | Reflection 对话与当前 Proposal 预览 |
| `POST /api/v1/proposals/{id}/adopt` | 采纳：在 active 分支创建 commit |
| `POST /api/v1/proposals/{id}/abandon` | 放弃：删除候选分支与 worktree，保留记录 |
| `GET /api/v1/om/versions` | 已采纳版本列表（commit SHA、摘要、时间） |
| `GET /api/v1/om/tree?commit=` | 指定 commit 的 OM 文件树 |
| `GET /api/v1/om/file?commit=&path=` | 指定 commit 的文件内容 |
| `POST /api/v1/admin/capability-catalogs` | 导入候选 OpenAPI 目录并返回差异 |
| `POST /api/v1/admin/capability-catalogs/{id}/accept` | 接受目录版本 |
| `GET /api/v1/admin/contributions` | 个人分支与组织 `main` 的差异 |
| `POST /api/v1/admin/contributions/{id}/merge` | 选择性合并至 `main` |

### ACP 通道

* 端点：`GET /acp`（WebSocket 升级），JSON-RPC 2.0 over WebSocket。
* 会话类型通过 `session/new` 的参数区分：`work` 或 `reflection`，并携带对应 `workId`。
* 服务端向客户端推送 `session/update` 通知，包含消息增量、工具调用状态、Proposal 更新事件。
* 断线恢复使用 `session/load`，按 `workId` 重建上下文；轨迹文件中状态为未知的命令恢复为 `unknown`，并提供“查询原命令结果”。
* Copilot 与 Reflection 对话复用同一 ACP 实现，避免两套实时协议。

## Authentication & Authorization

### 身份

* App 内嵌 Copilot：前端传递当前 App Access Token；后端调用 App 身份接口换取已验证 Email。
* Web 工作台：登录方式为 Unknown（对应 PRD 中 D01），实现前需先明确契约。
* Airic 不把 App Access Token 当作独立 Airic 账号；Token 不写入数据库、轨迹文件、日志与 Git。

### 会话与令牌处理

* Access Token 仅在内存中按请求传递，用于调用 App 身份接口和 Command API。
* Token 失效或被撤销时，终止后续业务调用，并在轨迹中将进行中的动作标记为 `unknown` 而非失败。
* Airic 自身发放短期会话凭据用于 Web 工作台与 ACP 连接鉴权（Proposed）。

### 授权模型

* 资源所有者：对自己的 Work、轨迹、Reflection、Proposal、个人分支与 worktree 拥有完全控制权。
* 管理员：可访问全部 Airic 资源；查看他人 Work 不改变该 Work 的模型所有者。
* 业务操作权限始终由 App 判定；Airic 管理员身份不带来任何业务权限。
* 首版不提供更细粒度的 Airic 权限配置。

## Integrations

### 业务 App

| 集成点 | 方向 | 说明 |
| --- | --- | --- |
| 身份接口 | Airic → App | 用当前 Token 换取已验证 Email |
| 页面上下文接口 | App → Airic | 页面说明、文本数据、`work_type`、`entity_id` |
| Command API | Airic → App | 仅调用已接受目录且 WD 允许的操作 |
| 命令结果查询 | Airic → App | 按幂等键查询原命令结果，用于恢复未知状态 |
| 前端嵌入 | App 前端 | Copilot 面板、上下文传递、成功后刷新页面数据 |

Command API 调用规则：携带幂等键与预期版本；网络超时或响应丢失不得判定为失败；成功以 App 回执为准，回执内容写入轨迹文件。

### 能力目录导入

1. 管理员上传或指定 App 发布的 Agent 专用 OpenAPI 文档。
2. 服务端解析并与当前已接受目录比较，输出新增、修改、删除及受影响的 WD package。
3. 接受前运行时继续使用旧目录；接受后仍需 `work.yml` 显式授权。
4. 能力 schema 转换为 pi-sdk 工具定义时进行输入输出约束校验。

### Git 与 OM 版本

沿用已定版本管理方案：

* Org main 分支：main
* User 分支：`users/{userId}`，HEAD 即 active OM。
* Proposal 候选分支：`proposals/{proposalId}`，base 为创建时的 active commit。
* worktree：按需创建、空闲回收；采纳或放弃后立即移除。开启reflection时会需要worktree。
* 采纳：在 active 分支创建 commit，结构化 trailer 记录理由、来源 Reflection、base version、证据引用与受影响路径。
* 组织侧：管理员选择性合并至 `main`；个人分支不被自动覆盖。

## Deployment

### 交付形态

* 单 Docker 镜像，包含 API、ACP 服务、Agent 运行时与 Web 工作台静态资源。
* 挂载卷：`/project`（Git 管理的 OM）、`/data`（SQLite、轨迹文件、agent 会话、临时 worktree）。
* 空 `/project` 可被初始化为 Git 仓库；已有内容不得被启动流程覆盖。

### 配置

* 模型供应商凭据、App 身份接口地址、Web 会话密钥等通过环境变量或部署密钥注入。
* 配置与凭据不进入 OM 文档、轨迹文件与对话展示。

### 启动与恢复

1. 校验并迁移 SQLite schema（drizzle-kit）。
2. 校验 `/project` Git 仓库状态，回收过期 worktree 租约。
3. 校验每个 Work 的轨迹文件可读性与写入游标；截断不完整的尾部记录并补写恢复事件。
4. 扫描活跃 Work 轨迹尾部，将仍处于进行中的动作标记为 `unknown`，等待结果查询。
5. 恢复 Work、Reflection 与未完成 Proposal 的可读状态。

### 运维

* 备份需同时覆盖 `/project` 与 `/data`；恢复后校验 Proposal 分支、轨迹文件与数据库记录一致性。
* Git remote 推送与拉取由部署运维人员负责，不由应用自动执行。

## Scalability & Performance

首版目标为单实例、单 App、多用户场景；容量与性能目标数值为 Unknown，需在首个真实部署后建立基线。

Proposed 的工程约束：

* 轨迹采用追加写与分段文件，避免单文件无限增长；读取使用游标分页，不整体加载。
* 轨迹写入在服务层串行化到每个 Work，保证顺序与可恢复性。
* worktree 采用租约与 LRU 回收，限制同时物化的 Proposal 数量。
* Agent 运行使用有界并发池，按用户限流，避免单用户占满模型调用能力。
* SQLite 开启 WAL，写操作集中在服务层，避免跨进程并发写。
* 若未来需要多实例，优先替换点为：数据库（迁移至 Postgres）、轨迹文件宿主（共享卷或对象存储）、worktree 宿主、ACP 会话路由（粘性会话）。

## Risks & Open Questions

| 项目 | 状态 |
| --- | --- |
| 未知结果命令的检索方式：按幂等键查找需扫描轨迹文件，是否需要一个轻量索引 | Proposed 待评估 |
| 轨迹文件的分段阈值、保留周期与归档方式 | Unknown |
| Web 工作台登录与鉴权方式（D01） | Unknown，需在实现前确定 |
| ACP 与页面上下文契约细节（D07） | 连接鉴权、事件恢复、页面快照版本待定 |
| Token 传递、在途失效与重新验证（D08） | 待定 |
| 能力版本兼容与命令恢复协议（D10） | 幂等键、预期版本、回执与状态查询细节待定 |
| Email 生命周期与身份冲突 | Unknown |
| 删除与保留规则 | Unknown |
| 组织约束的执行点与规则集合 | Unknown |
| 容量、并发、响应时间与保留周期 | Unknown，首个部署后建立基线 |

Proposed 的风险应对：对每个未定契约先写出最小接口定义与契约测试，再进入对应验收项；在契约确定前不将相关能力纳入交付门槛。
