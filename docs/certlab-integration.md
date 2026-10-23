# CertLab 接入 Forge：当前协议与交付改造

本文描述 CertLab 的现有接入以及下一步应完成的交付闭环。通用需求以 [App 集成、Agent 能力与交付需求](app-integration.md)为准；本文不把待实现的 Pi 配置入口或开发启动器描述成已存在的命令。

状态：当前接入指南。线协议以 CertLab 仓库 `docs/api/assistant-protocol.md` 为准；文档不代表后续完整交付方案已实现。

## 1. 责任分工

CertLab 拥有项目、报告、条款、资料固定版本、专业权限、业务事务和回执。Forge 拥有 Work/Turn、OM 修订选择、业务桥、检查点、轨迹、Reflection 和治理。Pi 提供原生会话、自动压缩、文件工具和扩展机制。

大型 PDF 的分块阅读、图文核对、笔记和压缩恢复是通用 Agent 能力；CertLab 提供分页文字、页面图像、区域及来源信息。组织 OM 规定条款评估、证据充分性、专业例外和复核职责，不维护 PDF 操作流程。现有认证措辞的 PDF Skill 和 OM 中的阅读细节需要在后续能力分离中调整。

现阶段一个 Forge 实例绑定一个 CertLab 和一个组织。API bootstrap 仍限定 `certlab` / `report-authoring`；这不是任意 App 的通用注册接口。

## 2. 开发接入闭环

开发者应能在本机运行 CertLab API/MCP、前端和 Forge，不经过 Docker build。下一步需由 CertLab 项目提供统一的联调入口；当前可分别运行服务，但尚无完整的配置加载、重载及生命周期编排。

联调配置要显式确定本地 Forge checkout、Agent 配置目录、开发数据根和种子来源；当前 Forge 尚无 Agent 配置目录参数。源码与扩展修改通过 watch、显式重载或相关服务重启生效，不承诺所有资源自动热更新。使用 workspace 包时检查是否需要增量构建，防止误用旧 dist。

每轮验证顺序：准备依赖 → 启动并检查地址/身份/组织/MCP → 打开临时报告 → 修改代码或能力 → 安全重载 → 继续同一开发 Work → 核对资源身份、实际读取和草稿回执。开发入口只能停止自己管理的进程；运行数据与真实业务数据分离。

当前源码可核对的入口与配置：

| 项目 | 当前位置或值 | 注意 |
| --- | --- | --- |
| Forge API 开发脚本 | `apps/api/package.json` 的 `dev`，根 `pnpm dev` 转发 | 使用 tsx watch；仍需准备 domain 依赖 |
| API 与工作台 | `FORGE_PORT`、`FORGE_BIND_HOST`、`FORGE_WEB_DIST_DIR` | 独立工作台默认从 `apps/workbench/public` 提供构建产物 |
| App 和组织 | `FORGE_CERTLAB_URL`、`FORGE_ORGANIZATION_ID` | App origin；MCP 为该 origin 的 `/mcp` |
| 浏览器连接 | `FORGE_ALLOWED_ORIGIN`、`FORGE_PUBLIC_URL` | 分别是允许的浏览器 Origin 与用户可访问的 Forge URL |
| 持久化 | `FORGE_PROJECT_DIR`、`FORGE_DATA_DIR` | 分别为生效 OM 与运行数据；不能指向测试业务数据 |
| 模型 | `FORGE_MODEL_PROVIDER`、`FORGE_MODEL_ID`、`FORGE_MODEL_BASE_URL`、`FORGE_MODEL_API_KEY` | 凭据不进 Git；测试默认用本地模拟模型 |
| 输出预留 | `FORGE_CONTEXT_OUTPUT_TOKENS` | 无 Forge 固定输入窗口；使用 Pi 原生压缩 |
| Agent 资源 | 当前显式加载随 Forge 发布的 Skill 与扩展 | 不读取通用 Pi 安装配置；新配置入口待实现 |

本机联调不能使用容器内服务名；容器部署也不能照搬宿主 `127.0.0.1`。两个入口共享业务和 Agent 配置契约，环境只覆盖地址、路径、Secret 和运行方式。

## 3. 身份、页面与 Work

1. 用户登录 CertLab，页面使用 Bearer Header 调用 Forge `POST /api/v1/app-sessions/bootstrap`，提供 `appId=certlab`、`workType=report-authoring`、报告 `entityId`，可带 `selection` 和 `workId`。
2. Forge 验证 App 身份、组织及权威上下文，检查目标和所有权，再创建或恢复 Work。页面字段只是聚焦提示。
3. 前端通过返回的 ACP 地址和短期票据发送 `session/new`，取得已验证的会话和历史。
4. `session/prompt` 启动运行，`session/update` 展示文本、工具活动及整理状态。`session/feedback` 处理检查点；反馈不授予专业权限。
5. `session/cancel` 请求取消；`session/reconcile` 查询未决命令。断连撤销 App 会话并请求停止相关运行，重新进入必须 bootstrap，不自动重放命令。

`/api/v1/auth/me` 是当前 actor/email 的权威来源；`integration.info` 绑定 App、组织与业务 release。App token 仅在现有内存授权生命周期内使用，不进 URL、文件、提示或 Pi 会话。Forge Web 用户角色与 CertLab 专业权限分别判定。账户初始化、停用及管理见 [用户管理](user-administration.md)。

## 4. MCP 发现、执行与原回执

每个 Turn 通过当前用户 token 分页读取 `tools/list`，规范化并固定不可变快照。工具变化从下一轮发现，失败不回退旧目录；不需要管理员接受，也没有 WD 工具白名单。[MCP 发现契约](contracts/mcp-tool-discovery.md)是当前约束。

`integration.info`、`command.context`、`command.receipt` 由 runtime 管理，不重复暴露给模型。模型提供业务输入；Forge 固定报告并关联原命令 ID、业务 release、Work/Turn 和调用元数据。CertLab 在原用例中重新检查实际用户、权限、版本、报告影响及事务不变量。

有效原回执证明 committed，明确的应用拒绝证明 rejected；传输中断、错误或不合法响应保持 unknown 并阻止后续写入。恢复查询原作用域内的原命令回执，不换新键重试；没有查到回执不证明无效果。连接成功、模型回复或本地笔记均不是业务结果。

## 5. 资料、原生会话与恢复

CertLab 返回固定资料修订、页码/区域和文字范围；正文用标准文本内容，图像用 MCP image 块。文字适合直接阅读时不必重复发送像素；图表、扫描内容和难辨认细节按需取页面及局部图像。摘要与索引用于定位，不替代原件。

Forge 校验来源、预算和图像，再经薄 Work MCP 桥交给 Pi。Forge 规范审计不重复保存大正文；原生 Pi 会话会在本地保存完整消息及图像，工作目录保存阅读笔记。这些都属于敏感持久化数据和备份范围，不能沿用历史“所有原文仅在内存”的说明。

当前会话按明确身份 create/open，原生文件工具和压缩负责执行接续。[原生会话契约](contracts/context-projection.md)说明现状。部署配置与扩展身份尚未进入完整装配及会话关联，这是下一步工作；已绑定文件缺失时不得改选最近会话。Reflection 使用独立会话与候选治理能力，不继承 CertLab token。

## 6. 发布与运行中的 OM

CertLab 项目固定 Forge 组件版本，版本化 Agent 配置、扩展包和系统依赖，构建发布镜像。开发入口直接使用同一配置源，生产产物包含验证后的资源，不在普通 Turn 安装依赖。

运行时持久化 OM `/project` 和数据 `/data`，Secret 单独注入。新组织记录种子来源；重启和软件升级不覆盖组织或个人 OM。新版种子的专业改进走显式治理，通用阅读能力更新走软件发布。

根 `docker-compose.yml` 已使用 `FORGE_CERTLAB_URL` 并要求 `FORGE_ORGANIZATION_ID`，是单 Forge 服务的本地构建示例。完整 Agent 依赖装配、固定发布版本和协调恢复仍待实现。当前启动步骤与限制见 [部署说明](deployment.md)。

升级前停止新任务、处理在途命令、备份 OM/数据及 App 恢复点，校验持久化格式和当前 OM 与能力组合。软件回滚不自动回退 OM 或撤销业务效果。恢复在隔离目录演练，包括路径修复、旧 Work、原生会话、未完成候选稿和原回执；仅健康接口成功不算完成。

## 7. 实施与验证入口

| 边界 | 当前代码入口 | 重点验证 |
| --- | --- | --- |
| App 适配 | `apps/api/src/certlab-client.ts`、`mcp-client.ts` | 真 MCP、身份隔离、分页工具、来源和原回执 |
| Work 业务用例 | `packages/domain/src/use-cases.ts`、`ports.ts` | 报告绑定、取消、未知结果及恢复，不混入 Pi 类型 |
| 原生执行 | `apps/api/src/pi-native-session.ts`、`work-mcp-bridge.ts` | 会话、资源、压缩、文件笔记、图像与 Reflection 隔离 |
| 交付 | `apps/api/src/config.ts`、Dockerfile、App 联调入口 | 显式配置、缺失诊断、依赖准备、版本归因与升级恢复 |
| CertLab | `certlab/interfaces/mcp.py`、`application/assistant/` | 委托原业务用例，保留专业授权和原子回执 |

已有 `certlab-contract.test.ts`、`tool-snapshots.test.ts`、`pi-native-session.test.ts` 及用例测试覆盖部分工程行为，不代表新交付需求全部完成。完整目标见 [需求中的实施顺序](app-integration.md#8-验收与实施顺序)和 [行为场景](acceptance/app-integration.feature)。

代码实施时运行对应仓库规定的 Domain/API、类型和必要前端/E2E 检查；协议验证使用真实 HTTP/MCP 与临时数据，本地模拟模型优先。真实资料外发需授权，验收记录事实、出处、接续能力和实际草稿回执，不要求模型必须判定符合。

`certlab-browser-fixture.ts` 以及 CertLab `tools/verify_airic_b1.py` 调用的协议/资料探针仍作为实际跨仓库验证入口维护；`pi-native-live-probe.ts` 用于显式授权的真实模型验收。它们不是服务启动步骤，不能对业务资料自动运行。
