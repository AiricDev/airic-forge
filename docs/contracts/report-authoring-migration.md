# report-authoring OM 迁移基线

首版 seed 来自 CertReporter 旧 sidecar 的 airic-sidecar/modules/certreporter/operating/report-authoring/。本表限定迁移范围，避免把旧运行机制或 Report Type 工作误当作新 Forge 的契约。

| 旧文件 | Forge 文件 | 迁移处理 |
| --- | --- | --- |
| work.yml | seed/project/work-definitions/report-authoring/work.yml | 保留 Work ID、报告能力白名单和文档清单；增加独立 SK 引用列表及明确的禁止提交/审批/导出说明 |
| policy.md | 同名 | 保留原有报告编制边界和证据区别 |
| method.md | 同名 | 保留定位字段、窄范围更新、逐次修订及面向作者的结果表达 |
| evidence.md | 同名 | 保留附件只作证据、不能把标准要求当作评估结果的规则 |
| precedent.md | 同名 | 保留示例范围、逐项更新和未完成项表述 |
| recovery.md | 同名 | 保留冲突与校验拒绝处理；结果未知时增加按原 commandId 查询回执 |

运行时只从固定的个人 HEAD 解析 work.yml 和被引用文档。旧 sidecar 的 Session、SSE、内部密钥及运行目录不迁入 Forge OM。旧五份 Markdown 的其他内容保持原文；后续实质改动通过 Proposal 审阅与采纳。
