# MCP 工具发现与权限边界

2026-10-21 用户明确决定：取消能力目录人工接受门槛，取消 WD 工具范围限制，直接使用 MCP 提供的工具，由 MCP 端控制用户权限。本契约取代旧目录导入/审批和 WD 白名单约定。

## 当前行为

每个 Turn 使用该 App 会话的原 Token，核对既有 App/组织/版本绑定，从 MCP `tools/list` 分页发现工具。校验 Schema、执行类型和命令回执元数据后，固定本轮规范化工具快照；元数据变化在下一轮发现，无需管理员操作。发现失败直接失败，不使用旧快照作为回退。只有 runtime 自用的身份、命令准备和原回执协议工具不重复暴露给模型；不按业务工具名称、前缀或 WD 内容筛选权限。

`AppToolSnapshot` / `AppToolDefinition` 是 Forge 使用的 SDK 无关 DTO，不是另一份能力注册表。`AppPort.discoverTools` 负责实时发现；`ToolSnapshotPort` 仅记录/按 digest 读取不可变快照，没有接受或授权语义。当前实现位于 `packages/domain/src/use-cases.ts`、`ports.ts`、`model.ts`，MCP 映射位于 `apps/api/src/certlab-client.ts`，SQLite 适配在 `database.ts`，接线在 `runtime.ts`。

`work.yml` 不再包含 `capabilities.allowed` 或 `completion.requiredCapabilities`。OM 编辑校验 WD 基本结构、文档和知识引用，不依赖 MCP 在线或任何目录。历史修订中存在的这两个字段不参与运行与权限判定，也不重写历史或 active HEAD。WD 是工作方法和知识路由；用户权限与发布哪些工具由 MCP 端负责。

报告/资源绑定、身份透传、输入校验、预期版本、幂等命令和原回执恢复保持有效。App 拒绝仍按原拒绝处理；超时或结果未知仍阻止后续写入，不能用新命令键重放原业务效果。检查点反馈不构成专业授权，业务结果仍由 App 原服务判定。

## 数据与接口

新 `mcp_tool_snapshots(app_id,digest,snapshot_json,discovered_at)` 自动建立，快照不得覆盖或删除。内容仅为工具公开元数据，不含凭据。`Turn.catalogDigest` 和历史 `catalog_digest` 字段继续作为工具快照摘要，避免重写既有 Work/轨迹及上下文摘要；工作台显示为“MCP 工具快照”。

旧目录、候选与接受记录保留为历史，运行和 OM 编辑不再读取；不把旧批准转为新授权。移除 `/api/v1/catalog`、`/api/v1/catalog/import`、`/api/v1/catalog/:digest/accept` 和 `accept-from-workspace` 路由，以及人工目录迁移脚本。启动自动进行新增快照表的结构升级，不需要导入/接受步骤。

上线前备份 Forge 数据和 OM，确认无运行中的任务，再升级并重启。用户需重新连接 App 会话；不修改 CertLab 数据或权限。

## 规划与验证闭包

自然入口是 Copilot 的 `CapabilityCatalogNotAccepted`；沿 Turn 用例定位到旧批准仓库、OM 校验、HTTP 与夹具。没有根 architecture-map.md，沿既有 use case/ports/runtime 路由完成，不新建架构索引。

| 关注点 | 分类 / 所有者 | 验证 |
| --- | --- | --- |
| 动态发现与单轮固定 | use-case-policy / ForgeUseCases | 普通用户、无接受记录首次运行；下一轮新工具；本轮固定；发现失败无回退 |
| WD 去白名单 | entity-invariant / WorkDefinition + OM 校验 | 无白名单的 WD 可运行；旧字段为空也不限制；保留文档/SK 约束 |
| MCP 可信映射 | adapter-mechanism / CertLabClient | 真 MCP SDK 契约、动态工具、分页、Schema、当前身份和拒绝结果 |
| 历史快照 | port-contract / ToolSnapshotPort；persistence / ForgeDatabase | 相同摘要幂等、内容冲突拒绝、不可变、旧审批行不变 |
| 交付与呈现 | delivery / server 与工作台 | 旧目录接口 404、WD 预览和 Turn 快照标签、浏览器回归 |

边界检查：CertLab 的 MCP dispatch 每次认证原 Token、加载 actor，再调用原 query/command 用例；业务权限和专业边界不由 Forge 角色或 WD 授予。此行为变更已获用户明确授权，无待决定的产品规则；不新增工具平台、不修改 CertLab 专业权限或不可变历史。
