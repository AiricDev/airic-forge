# MCP 工具发现与业务权限

每个 Turn 使用当前 App 会话的 token，从 MCP tools/list 分页读取工具，校验 schema、执行类型和回执元数据，固定并持久化不可变快照。工具元数据变化从下一轮发现；发现失败明确失败，不用旧快照代替当前发现。

AppToolSnapshot/AppToolDefinition 是 SDK 无关的来源 DTO，不是第二份注册表或授权目录。ToolSnapshotPort 只记录及按摘要读取，不能覆盖或删除。WD 只管理业务工作方法和知识引用，不声明工具权限；OM 编辑不依赖在线目录。

MCP tools/call 请求最终委托 App 原业务用例。身份、组织、目标绑定、输入、预期版本和专业授权仍每次检查。integration.info、command.context、command.receipt 是 runtime 自用的绑定与恢复能力，不重复暴露给模型。

模型只提供业务输入；Forge 注入命令身份、Work/Turn、业务 release 和关联。有效原回执才证明 committed；应用明确拒绝可证明 rejected；传输丢失或非法响应保持 unknown，阻止后续写入。恢复查询原命令回执，不以新键重放；找不到回执不等于未发生效果。

## 数据与资料

mcp_tool_snapshots(app_id,digest,snapshot_json,discovered_at) 保存工具公开元数据，不包含凭据；Turn.catalogDigest 是其固定摘要。数据库通过触发器禁止快照修改与删除。

资料读取返回固定修订和来源位置。PDF 可返回页文字与像素，region 是以左上为原点的归一化页面矩形；区域图像的文字范围仍可为整页，必须按返回 text_scope 标识解释。图像经校验后以标准 MCP image 块传入 Pi，不能把摘要或 base64 文本冒充原件。

规范业务审计只保留来源、范围、状态与回执等必要元数据。完整消息/图像可在受保护的本地原生 Pi 会话保存；文档工作笔记不升级为业务权威。搜索未命中、未索引及不支持的读取都不能推定事实不存在。

## 实现与验证

- 用例与端口：packages/domain/src/use-cases.ts、ports.ts、model.ts。
- App 与 MCP 适配：apps/api/src/certlab-client.ts、mcp-client.ts。
- 原生桥与内容：work-mcp-bridge.ts、material-tool-content.ts。
- 不可变快照：database.ts；组合根 runtime.ts。
- 测试：certlab-contract.test.ts、tool-snapshots.test.ts、material-tool-content.test.ts、pi-native-session.test.ts、work-execution.test.ts。

升级和数据恢复见 [恢复契约](persistence-and-recovery.md)，实际接入见 [CertLab 指南](../certlab-integration.md)。
