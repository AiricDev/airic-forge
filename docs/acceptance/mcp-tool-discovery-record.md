# MCP 直接工具发现验收

日期：2026-10-21。用户明确授权取消人工接受目录和 WD 工具范围限制，权限由 App MCP 控制。当前契约见 [MCP 工具发现](../contracts/mcp-tool-discovery.md)。

## 实现与验证

- Turn 直接调用当前用户的 `AppPort.discoverTools`，固定并持久化本轮快照。取消批准记录/目录变更阻断、WD 白名单、按业务工具名或前缀的 Forge 过滤。保留报告绑定、当前身份、检查点、命令准备、幂等、原回执和未知结果恢复。
- WD 校验与预览不再要求能力列表和必需能力；新模板已移除字段。当前实例已有 WD `certification-assessment` 结构验证通过，旧字段不再参与权限判定；未改写 active OM 或 Git 历史。
- 删除目录导入/接受 HTTP 路由与人工迁移脚本。工具快照新表不可覆盖、不可删除；旧候选与审批表只保留历史。元数据变化下一轮直接发现，发现失败不回退。
- `pnpm build`、`pnpm check`、前端 `format:check` 和 `git diff --check` 通过。
- `pnpm test`：领域 28 项、API 150 项、前端 15 项通过；API 1 项既有测试跳过。
- `pnpm test:e2e`：19 项全部通过，使用独立数据库和 Git 根目录。
- 回归证明：普通用户无人工接受即可执行；MCP 新工具即使不在旧 WD 列表也进入本轮工具集；运行中发布新工具不改变当前快照，下一轮才生效；发现失败即失败，已有快照不作为回退；旧目录接口 404；MCP 动态发现、Schema、凭据隔离与原回执语义保持验证。
- OM 编辑测试不再预置任何目录快照，原知识、文档、草稿、提交和贡献治理测试仍通过。

## 当前实例

仅停止和重启 Forge，没有修改 CertLab 代码、业务数据或权限。确认无运行中的 Turn/Reflection 后，完整备份数据根目录与 OM 仓库到：

`runtime/backups/mcp-tools-20261021-222627/forge-before-mcp-tools.tar.gz`

同目录有 SHA-256、原表内容基线和 `upgrade-result.json`。先在数据库副本升级，再启动实际实例；升级前后原有所有表内容校验值及 OM Git refs 均相同，新建 `mcp_tool_snapshots`。`http://127.0.0.1:4175/health` 正常，根页面、脚本及 Work/Reflection 深链接正常。

实际报告页面的浏览器授权被拒绝，未尝试其他浏览器、读取实际报告内容或进行实际模型调用。独立真实 MCP SDK 契约和浏览器回归已通过；实际报告内的 Copilot 需由用户刷新并重新连接后试用。

## 变更后的设计反思

可见路径：错误 → Turn 用例 → 旧批准 Port/SQLite → OM 校验 → 当前 MCP adapter → runtime/HTTP → 测试与文档。初次调查和已确认产品决策在本任务上下文中可见；权限拦截期间的草稿已撤回，最终实现依据后续明确授权。

修改闭包及未来入口在当前契约列明：用例负责本轮发现和执行，MCP adapter 负责工具映射，App 拥有业务权限，快照端口只承担追溯。WD/OM 编辑不需要访问实时 App 或批准仓库。

| 检查 | result | evidence | future-risk | confidence | level |
| --- | --- | --- | --- | --- | --- |
| Missing Path | not-found | 报错可直接定位 use-cases；类型检查、契约和端口引用明确暴露夹具/适配器修改闭包 | 新增调用方应沿 AppPort 与当前契约接入，避免重建目录 | high | — |
| Boundary Bypass | not-found | 权限变化有用户明确授权；仍通过原 AppPort/MCP 和原业务权限、命令回执；SDK 类型没有进入内层 | 不能将快照记录误用为批准或把协议元数据当作用户权限 | high | — |
| Unowned Capability | not-found | 实时发现归 AppPort、持久追溯归 ToolSnapshotPort，OM 结构校验不再依赖网络/人工批准 | 后续若扩展新 App，须继续由该 App 的 MCP 判定用户权限 | high | — |

观察范围内未发现需要另行处理的路由问题；不新增架构索引或修改技能/指导文件。这里的权限边界调整是用户已决定的产品变更，不能解释为新增 Forge 专业授权。
