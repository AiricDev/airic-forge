# ADR 0002：CertReporter 协议、并发与恢复

## 决定

1. CertReporter Drawer 先保存本页编辑，再以当前 bearer token、appId、workType、reportId 和选择位置向 Forge bootstrap。Forge 从 CertReporter 身份接口读取已验证 Email，再调用 report.context 验证目标和取得权威投影。浏览器文本和选择位置均不授予权限。
2. Bootstrap 签发短期、单次认领的 ACP 连接票据。连接断开或 Forge 重启后，App token 不恢复；用户重新 bootstrap，复用原未结束 Work/Session。旧轨迹仍可读取。每 Turn 在开始时固定选定的 OM HEAD、已接受目录 digest、投影 digest 和实际加载文档；页面切换不改变本轮目标。
3. App 目录由 MCP tools/list 分页发现并规范化为候选；tools/call 承载业务调用。管理员接受具体目录版本后，只有该版本且被当前 WD 允许的能力可注册给 Work Agent。目录变化从下一 Turn 起判断兼容性；如果已允许的能力在已接受版本中缺失或不兼容，拒绝该 Turn 并显示绑定变化。旧 Turn 保留原目录 digest。
4. 每条业务 Command 带唯一 commandId、workId、actionId、expectedDomainRelease 和业务预期修订。只有 CertReporter 回执可确定 committed 或 rejected。响应丢失时记录 unknown 并用原 commandId 查回执，不能以 Agent 文本或 HTTP 连接状态推定成功。令牌撤销后查询也可能被拒绝；等待重新取得有权身份，不以新命令 ID 重放。
5. Proposal 各占独立分支与 worktree。外部修改个人 active 分支 HEAD 从下一 Turn 生效。采纳在 base 等于当前个人 HEAD 时执行；不相等则保留 Proposal，用户 rebase 后重新校验与审阅。服务重启后从 SQLite 元数据与 Git 工作区重新发现未完成 Proposal；不得清理或覆盖未提交修改。并发采纳只允许一个基于原 HEAD 的提交成功。
6. Reflection 固定 Domain Knowledge、Delegation Gap 和 API Suggestion 三种 lens。管理员可启停和版本化提示；每次 Reflection 记录使用版本。证据不足及仅有 API Suggestion 时可以没有 Proposal。API Suggestion 是可导出结果，不进入能力目录。
7. SQLite 记录资源和版本索引，JSONL 保存规范化轨迹，Git 保存 OM 内容。数据不一致时保持 running 或 unknown 并显式恢复，不补造成功事件。备份与恢复同时覆盖 Forge /project、Forge /data 和 CertReporter 自身数据，见持久化契约。

## 验证入口

- Forge 协议夹具：apps/api/src/certreporter-contract.test.ts。
- CertReporter 端点测试：tests/api/test_airic_domain_protocol.py。
- 行为验收：docs/acceptance/p0-stages.feature。

本 ADR 固定行为合同。Agent runner、锁和恢复器的具体机制在所属阶段实现，并由上述行为场景验收。
