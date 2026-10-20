# 个人 OM 直接提交验收记录

## 范围

对应 `om-direct-commit.feature`。原生 Git 接入、独立及 Work-linked Reflection、草稿直接提交、组织同步草稿、旧个人 Proposal 迁移和工作台入口已实现。组织贡献治理保留。

验证只使用临时 Git、SQLite、JSONL 和隔离浏览器服务。没有重启或迁移现有 4175 实例，也没有修改其 OM。模型使用确定性夹具，未执行外部模型现场探测。

## 验证结果

- `pnpm build`：通过。
- `pnpm check`：通过。
- `pnpm test`：领域 23、API 102、工作台 14 个测试通过。
- `pnpm test:e2e`：15 个 Chromium 用例通过，包括独立讨论、刷新、直接提交、过期草稿合并与丢弃、组织吸收及同步、令牌创建和撤销。
- 新增代理安全用例后，`pnpm --filter @airic-forge/api exec node --test dist/personal-git-http.test.js`：3 个用例通过。真实 Git 覆盖 clone/push/pull、保留提交、跨用户拒绝、未知对象拒绝、强推和额外 refs 拒绝、非法文件拒绝、管理员不可代推、撤销和 HTTPS 代理来源。
- 格式化后重新运行构建、类型检查及 `pnpm --filter @airic-forge/workbench format:check`：通过。

全量回归发现并修正了旧 Proposal 浏览器操作和独立讨论刷新时的重复 key / 重挂载问题。两处旧工具集测试改为核对 WD 实际授权，而不是整个能力目录；未扩大 seed 授权或改动既有 CertLab 目录修改。

旧数据迁移有只读预览、应用及重复执行测试。生产数据尚未迁移；操作前必须停 API，并备份 project 与 data。部署和迁移步骤见 `../personal-om-changes.md`。

## 变更后设计复盘

本次续接的验证、界面修正和文档收尾过程可直接观察；早期规划和大部分实现过程只保留交接摘要，对该部分路径判断为 unknown。以下结论仅覆盖可观察的收尾过程，整体置信度 medium。

未来修改路径：行为规范 → `PersonalOmChanges` / `GitAccess` 及端口 → Git、数据库和 HTTP 适配器 → 工作台与对应测试。此次没有引入新的层或另行决定能力归属。

| 检查 | 结果 | 证据 | 后续风险 | 置信度 | 建议层级 |
| --- | --- | --- | --- | --- | --- |
| Missing Path | not-found | 通过既有构建、测试和工作台文档定位到剩余调用及浏览器契约，并补齐当前流程指引 | 收尾过程未观察到可操作的路由缺口 | medium | 不适用 |
| Boundary Bypass | not-found | 网页确认提交与 Git 发布都进入个人 OM 用例；校验、写锁和发布仍由已有边界负责 | 收尾过程未观察到新增旁路 | medium | 不适用 |
| Unowned Capability | not-found | 草稿、提交由个人 OM 用例负责；令牌由 GitAccess 负责；Git 传输与合并留在适配器 | 收尾过程未观察到不明确的新职责 | medium | 不适用 |

未发现需要另行修复的可操作路由问题。不建议因此新增注册表、抽象层或修改 AGENTS / skill。
