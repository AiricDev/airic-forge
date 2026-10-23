# Pi 原生会话、资源与 Work MCP 桥

本契约取代临时投影、自定义摘要缓存和强制结构化阅读笔记；历史验收记录仅说明旧实现。当前只有 Pi 1.2.0 原生会话/自动压缩这一条执行路径。

2026-10-23 后续需求见 [App 集成与交付](../app-integration.md)：把部署声明的 Pi 配置与能力资源纳入装配/身份，并把通用 PDF 操作流程从 OM 迁出。下文描述当前显式资源实现，不表示通用配置加载已完成，也不要求组织 OM 维护阅读细节。

## 职责与身份

- `AgentExecutionScope`包含组织、用户、Work、Turn、OM修订、工具快照摘要。领域用例传入身份和当前事实，Pi类型及文件路径仅存在适配器。Reflection使用独立kind/id，工具身份还包含lens版本与提示。
- `pi-native-session.ts`复用SessionManager.create/open；用户/Work/kind决定工作目录，OM/工具快照/模型/策略版本决定会话epoch。binding.json只指向明确的原生会话文件，不扫描“最近会话”。已绑定文件丢失或非法绑定明确失败，不伪造恢复。
- 当前App事实、人类纠正、未决命令及回执仍精确提供；历史讨论通过按需工具读取。没有旧原生会话的Work从当前事实开始，不重新发送全部历史。更换epoch保留原会话和工作文件。
- 运行目录为数据目录下agent-workspaces的哈希身份路径；正文、图像和原生消息保存在本地Pi会话，私有推理不进入前端/Forge审计。开发期原生工具以宿主用户权限运行，cwd不是安全边界，不宣称用户间OS隔离。

## 原生能力与资源

保留默认系统提示，附加固定OM和专业约束；通过显式ResourceLoader只加载当前OM、发布的pdf-reading Skill及原生MCP/tool_search扩展，不加载宿主全局配置。原生read/write/edit/bash/grep/find/ls提供文件操作；bash使用原生工具构造器，子进程环境不继承模型/业务凭据。

自动压缩开启，使用模型声明窗口、默认20K近期保留及至少16K/当前输出上限的reserve，不再使用Forge输入窗口或第二套摘要器。原生token估算、原始条目和compaction条目归Pi管理。输出上限继续使用FORGE_CONTEXT_OUTPUT_TOKENS。FORGE_CONTEXT_INPUT_TOKENS已删除，不保留旧逻辑开关。

阅读技能指导Agent在reading-notes.md/progress.md记录来源、事实、疑点、覆盖和下一步。笔记可用于继续分析，不能升级为原件、实时App状态、专业接受或OM。没有每页硬门槛。恢复先看笔记，只有具体问题、矛盾和版本变化才重开原件。Reflection只在临时文件中分析，正式候选编辑仍经治理能力。

## MCP、授权与审计

`work-mcp-bridge.ts`使用标准MCP Server和Streamable HTTP，在本机随机端口暴露当前回调。每次运行独立内存Bearer凭据，未授权请求拒绝；结束/取消时关闭服务。凭据不写配置、提示和会话。

业务Schema来自当前不可变工具快照；Pi原生MCP注册并通过tool_search延迟加载。不再转换为自定义Pi ToolDefinition。桥只将请求交回原用例，复用报告绑定、版本检查、关联、命令ID、原回执和未知结果保护；不重建专业权限。

Work附带检查点、按需OM与历史读取。Reflection仅提供已有Work轨迹和候选读写回调，无App Token。MCP图像使用原生image块，文本包含固定来源元数据，不把base64当文字或视觉摘要冒充原件。

Forge审计增加message.payload.agentRuntime：会话绑定、工具名/调用ID/状态、整理元数据和agent_settled，不复制工具大正文或私有推理。原有业务observation/action、检查点及人类反馈不变。取消仍等待在途操作，原生恢复不能自动重放未决业务命令。

## 路由与验证

领域边界：AgentRunnerPort/ReflectionAgentPort及ForgeUseCases；共用适配器：pi-native-session；MCP交付：work-mcp-bridge。既有TrajectoryPort和AppPort继续持久化审计与业务回执，不增加数据库表。

pi-native-session.test验证显式恢复、笔记保留、身份轮换/隔离、凭据不落盘、原生延迟MCP、自动压缩后接续保存草稿以及Reflection治理写入。现有用例测试继续覆盖取消、未知回执、检查点、重复请求与专业权限。真实资料验收另记，不以模拟模型证明真实专业结论正确。
