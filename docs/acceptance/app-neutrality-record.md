# 2026-10-23：清除组件中的App业务耦合

Forge作为通用组件，App代码适配器承担具体业务。当前实例继续连接CertLab，不自动迁移组织主分支、改写报告、重放命令或外发新资料。

## 清理范围

| 原耦合 | 当前归属/实现 |
| --- | --- |
| 内置CertLabClient、App身份URL、certlab/v1及报告/评估DTO | CertLab agent/integration/certlab.ts；Forge只提供AppAdapterFactory/AppPort及通用MCP/schema服务 |
| Domain/HTTP写死App和report-authoring，Session混用reportId/entityId | 通用appId/workType/entityId；权威上下文检查命名空间和原对象ID；工作类型不再是固定业务枚举 |
| 用例直接查询assessment.context、判断记录号与project字段 | 每个命令统一交AppPort.prepareCommand；业务目标、版本与回执语义归App；Forge保留关联、pending/unknown阻断及原回执恢复 |
| Pi/MCP桥按asset.read分支、Domain保存Asset字段白名单 | App提供auditObservation与toolContent；通用桥传递text/image，不知道业务工具名 |
| 硬编码实例App、默认certlab目录及环境变量 | 配置FORGE_APP_ID/URL/ADAPTER_MODULE/WORK_DEFINITION；通用目录runtime/project与runtime/data；旧变量不回退读取 |
| CertLab浏览器夹具和业务契约测试进入API产物 | 迁至App tools/forge-acceptance；Domain/API产品与测试分别编译，构建清空旧文件，发布边界检查防止回流 |
| Forge复制App业务种子及38项真实业务测试目录 | 删除seed/certlab；仅保留tests/fixtures内的通用OM和最小合成协议，不镜像App目录 |
| 工作台固定报告编制/Report Type标签 | 通用工作类型筛选、真实类型显示和业务对象文案 |

App适配器为显式受信任发布代码，不从OM或工作文件加载；工厂只获得App/组织/地址配置，不传递模型密钥。不是自动App注册、另一套授权目录或Agent框架。

## 行为与升级边界

- Bootstrap传appId/workType/entityId；App Work查询同样传三者。CertLab客户端和开发/镜像装配均已同步。
- App版本/目标预检失败时未发出命令，保留诊断并返回工具错误，允许修正输入；已发出的unknown仍阻止后续业务写入，原键恢复，不重放。
- 实例绑定和快照都检查App及组织。新协调快照格式为2，旧包保留但不猜测补字段；用原版本恢复后再按明确升级流程处理。
- 既有Work、Git、业务回执和原生会话保留；这次源码清理不清理运行数据。

## 验证

| 层面 | 结果 |
| --- | --- |
| Domain严格类型/单元 | 21通过；两个资料投影测试迁至App |
| API严格类型/全量 | 114通过，含库存/博物馆两类生产Runtime、异构命令定位、未知回执恢复与不重放、外部App快照拒绝、发布边界及工厂配置不传模型密钥 |
| App适配器契约 | 26通过；保留业务身份、来源、文字范围、图像、回执与公开元数据断言 |
| App真实HTTP/MCP | b1/b3/b4/b5/pdf五组通过，独立临时数据和合成模型 |
| Forge工作台 | 类型/格式、15项单元、构建通过；最终夹具下18项浏览器通过，API建议导出旧名称断言修正后单独重跑通过，19项场景全部覆盖 |
| CertLab | uv sync/ruff/格式/mypy通过；1576通过、7跳过；前端npm ci/格式/类型/125项单元/构建通过；浏览器63通过、1条件跳过，包含Copilot |

Docker容器执行未验证；未运行真实模型评估，因此不据此宣称专业判断质量提升。

## 本地生效与恢复点

确认无活动Work/Reflection后，于2026-10-23T10:58Z重启Forge，首次PID93352，补齐App报告类型约束后最终PID93696。App API/前端/Worker未重启。Forge/API健康200、工作台和App网页200、匿名业务查询401。使用随后撤销的临时App Token验证现有报告的通用Work查询返回原绑定1项；没有触发模型或专业写入。

- Forge运行数据与OM复制：runtime/certlab/backups/before-app-neutrality-2026-10-23T10-58-20-598Z，SQLite完整性校验通过。
- App原生complete bundle：data/app-neutrality-backup-2026-10-23T10-58-20-598Z/20261023T105821Z-43661dbc66744db2b83a73cf508892ee，68文件、0引用问题。

上述为本次停机前运行数据恢复点，发布代码/私有配置仍由项目版本与运维配置单独管理，不声称备份了旧进程的内存代码。

## 修改后的设计复查

本轮路由覆盖源码审计、端口、运行时装配、App适配器、测试/发布与本地生效。修改闭包还包括App客户端字段、开发/Compose装配、原生图像表示及恢复契约，不只移动文件。

| 检查 | 结果、证据与后续风险 |
| --- | --- |
| Missing Path | found，high，how-level，已修复：旧集成文档把内置CertLab路径当作通用接入入口，部分技术说明仍称显式配置未实现；下一App容易复制专用代码。改为公共AppPort/工厂契约与App自身指南，更新现有路由表。 |
| Boundary Bypass | found，high，how-level，已修复：Domain直接读取assessment记录号、Pi桥按Asset工具名判断图像，重复了App责任。改为App预检/投影/内容回调；原版本/目标/权限/回执通过App契约与跨系统测试保留。 |
| Unowned Capability | found（duplication-risk），high，how-level，已修复：业务种子和真实工具目录同时出现在组件与App。删去组件副本，组件测试使用最小独立协议；没有增加注册表或权限系统。 |

上述为发现并完成修复的信号，不是仍待处理的问题。当前未发现需要另行决定的新所有权问题。静态发布边界与第二App测试防止再次只靠重命名宣称通用，但不证明所有未来App可零代码接入。


最终App模块重新加载恢复点（2026-10-23T11:11Z）：Forge runtime/certlab/backups/before-app-neutrality-final-2026-10-23T11-11-51-516Z；App complete bundle data/app-neutrality-final-backup-2026-10-23T11-11-51-516Z/20261023T111152Z-4a377fd7adbc48b7a124068ca805417e。SQLite完整性通过，App为68文件/0引用问题。最终健康200，现有Work只读查询仍返回1项，临时Token已撤销。App工作类型、报告资源类型、命名空间和对象ID约束已由26项App契约明确覆盖，未被通用化放宽。
