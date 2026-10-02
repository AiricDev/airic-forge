# ADR 0001：P0 运行与版本契约

## 决定

- AiricForge 以独立服务运行，CertReporter 是首个 `certreporter` App 集成，首个 Work Type 为 `report-authoring`。
- OM 使用 `work-definitions/<id>/work.yml` 多文件 package；Subject Knowledge 使用 `subject-knowledge/<id>.md`。文档元数据由 AiricForge 解释，正文由 Agent 解释。
- 个人 `users/<userId>` 分支 HEAD 是 active OM。外部提交立即在下一 Turn 生效，不再导入为未采纳 Proposal。
- Reflection Proposal 位于 `proposals/<proposalId>` 分支和独立 worktree。采纳仅当 Proposal 的 base commit 等于当前个人 HEAD 时成功；否则需 rebase、重新校验和重新审阅。
- 一个 Work 由 `(ownerUserId, certreporter, report-authoring, reportId)` 标识并自动恢复。一个 Work 可有多个 Reflection；每个 Reflection 最多一个 Proposal。
- 每一 Turn 记录实际 HEAD、能力目录 digest、CertReporter 认知投影 digest 与加载文档清单。后续采纳不改写既有 Turn。
- Forge 使用独立本地账户；CertReporter bearer token 仅用于当前 App bootstrap 与 ACP 运行会话，绝不持久化。

## 对现有 PRD 的修订

本决定替换“外部 Git 提交可导入候选但不自动生效”和“同一 worktree 只容纳一个未完成 Proposal”的表述。Proposal 并行不改变 active HEAD；未采纳外部提交不再是 P0 支持的状态。
