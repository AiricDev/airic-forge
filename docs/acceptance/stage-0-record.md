# 阶段 0 契约基线验收记录

日期：2026-10-02

| 完成门槛 | 证据 | 结果 |
| --- | --- | --- |
| 产品与版本决策 | decisions/0001-p0-runtime-contract.md、decisions/0002-p0-protocol-and-recovery.md；PRD 的失效待决引用已清理 | 通过 |
| 首版 OM 与迁移基线 | seed/project/work-definitions/report-authoring/、contracts/report-authoring-migration.md；五份 Markdown 与旧侧车逐项比对，仅 recovery.md 按已确定的回执协议增补 | 通过 |
| CertReporter 可执行协议夹具 | apps/api/src/certreporter-contract.test.ts；Forge API 包测试 9/9 | 通过 |
| CertReporter 真实端点契约 | CertReporter tests/api/test_airic_domain_protocol.py；6/6 | 通过 |
| 对象关系和权限矩阵 | contracts/resource-ownership.md | 通过 |
| 持久化与恢复规则 | contracts/persistence-and-recovery.md | 契约已定；实现和故障验收归阶段 2/5 |
| 各阶段验收脚本草案 | acceptance/p0-stages.feature | 通过；浏览器执行归阶段 1–5 |

阶段 0 关闭的是契约和迁移基线。它不证明阶段 1 的工作台、管理员授权或重启恢复，也不证明阶段 2 的真实 Agent 命令、ACP 浏览器连接及故障恢复。下一步按开发计划进入阶段 1 的纵向切片与验收。
