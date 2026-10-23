# AiricForge 当前技术设计

本文件只描述当前架构与实现入口。显式 Pi 配置、快速联调、初始化和恢复入口见 [部署手册](deployment.md)；行为要求见 [App 集成需求](app-integration.md)。

## 运行与依赖

- Node.js 24、pnpm workspace、TypeScript；依赖以各 package.json 与 pnpm-lock.yaml 为准。
- API 使用 Fastify、WebSocket/ACP；Reflection 使用持久化 Run 和 SSE。
- Pi SDK 精确锁定 1.2.0。Work 与 Reflection 复用原生会话、文件工具、自动压缩及显式资源。
- MCP 使用官方 TypeScript SDK，业务调用经 CertLab MCP 委托原业务用例。
- SQLite 保存用户、业务工作和索引；Git 保存 OM 内容、草稿及贡献；JSONL 保存规范化工作轨迹。原生消息/图像保存在本地 Pi 会话。
- 生产 UI 为 apps/workbench，React、MUI 和 assistant-ui；产物位于 apps/workbench/public，由 API 同源提供。

当前为单 API 进程。执行锁、短期授权和模型运行在进程内，不支持多个进程共享运行任务；目录不承诺 OS 级隔离。

## 依赖方向与源码入口

| 责任 | 位置 |
| --- | --- |
| Work、专业上下文来源、执行身份、业务命令与检查点 | packages/domain/src/use-cases.ts、work.ts、work-context.ts、ports.ts |
| OM 结构、个人提交及组织治理 | operating-model.ts、om-changes.ts、use-cases.ts |
| 用户角色、停用与运行收尾 | user-administration.ts、password-administration.ts、reflection-runs.ts |
| HTTP、ACP、SSE 与同源校验 | apps/api/src/server.ts、om-http.ts、reflection-http.ts、user-http.ts |
| App MCP、资料来源与回执映射 | certlab-client.ts、mcp-client.ts、material-tool-content.ts |
| 原生运行、资源与短期业务桥 | pi-native-session.ts、pi-work-agent.ts、pi-reflection-agent.ts、work-mcp-bridge.ts |
| OM Git、个人提交与草稿 | git-om.ts、personal-git-om.ts、git-om-workspaces.ts |
| 组织贡献与个人 Git 传输 | git-contributions.ts、git-http.ts |
| 用户/Work 数据与轨迹 | database.ts、trajectory.ts |
| 组合与配置 | runtime.ts、config.ts、instance-binding.ts |
| UI、导航及 Markdown | apps/workbench/src/index.tsx、workbench/WorkspaceApp.tsx 及其页面组件 |

适配器依赖领域端口；领域不导入 Pi、Fastify 或 SQLite 类型。业务权限由 App 用例判断，HTTP 或模型文本不能替代授权。

## 执行路径

1. App bootstrap 验证用户、实例组织、报告与已有 Work，建立内存凭据和 ACP 票据。
2. Turn 用例取权威 App 状态、当前个人 OM HEAD 和 MCP 工具快照，解析 WD 与必要知识并固定来源。
3. Pi 适配器按明确身份 create/open 原生会话，附加 OM 与当前事实，使用延迟 MCP 发现工具。
4. 业务桥将调用交回已有用例，注入关联和原命令身份；App 验证输入、权限、版本，返回原始回执。
5. 规范轨迹关联结果、检查点和运行元数据；Pi 保存原生消息与压缩条目。未知结果不自动重放。

详见 [MCP 契约](contracts/mcp-tool-discovery.md)、[原生执行](contracts/context-projection.md)及 [CertLab 接入](certlab-integration.md)。

## OM 与 Reflection

生效 OM 读取 Git 修订。个人草稿仅为 detached worktree 文件；发布走 PersonalOmChanges 校验和条件提交，未确认内容不生效。组织贡献在独立分支追加选择提交并经显式采纳合入 main。

Reflection 使用相同的原生执行装配，但只提供轨迹和候选治理工具，不继承 App token。私有分析文件不能直接替代正式候选保存。Run 持久化接收、当前回复、工具状态和终态；SSE 重连读取快照，不重跑模型。详见 [Reflection 流式契约](reflection-streaming.md)。

## 存储与部署

新数据库直接建立当前结构，不建立旧 Proposal、数据库 OM 草稿或贡献表，不运行历史转换器。已有当前结构按原身份继续读取，不删除其中任何历史表、行或 Git 引用。未升级的旧产品数据格式不在兼容承诺内；切换前应单独备份和确认。

运行目录与只读发布配置分开；当前 config 尚未提供 App 自选 Pi 资源目录。启动参数和本地检查见 [部署说明](deployment.md)。容器构建是发布路径，本机开发可独立启动 API 与前端，完整快速联调入口仍待实现。

## 验证

Domain 测纯规则；API 测真实 Git、SQLite、MCP、ACP 和原生 Pi，模型由确定性服务替代；Workbench 测呈现与交互，Playwright 用一次性真实 API。真实资料验收单独授权和记录。

维护命令为 pnpm build、pnpm check、pnpm test、Workbench format:check 与 pnpm test:e2e；入口见各 package.json。当前测试映射及清理验证见 [清理记录](acceptance/repository-cleanup-record.md)。

资源装配：`apps/api/src/agent-resources.ts` 使用 Pi 原生包管理/加载器；`forge-ops.ts` 拥有显式初始化命令，`deployment-state.ts` 拥有离线快照与路径修复，`service-lock.ts` 管理单服务实例运行锁。App 启动与镜像装配由 App 仓库负责。
