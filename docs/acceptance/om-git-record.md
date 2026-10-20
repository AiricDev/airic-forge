# OM Git 原生状态验收

## 实现

- 草稿内容只保存为隔离 detached worktree 中的未提交文件；摘要、冲突和同步来源保存于该 worktree 的私有 Git 元数据。
- 确认提交记录理由、作者、来源及幂等请求信息，校验后快进个人分支；确认或丢弃后移除草稿 worktree。
- 创建贡献即创建 `contributions/<id>` 和元数据提交；文件选择通过三方补丁追加提交，校验失败不发布候选提交。
- 采纳创建非快进合并提交；状态、所选路径、采纳版本、贡献数量和采纳耗时均来自 Git。
- 命令行合并后显示已采纳；分支追加提交后重新显示待处理，旧版本不能被采纳。
- 管理员可显式放弃待处理贡献。HTTP 的 `review` / `reviewedRevision` 暂作兼容名称，不代表独立审阅状态。
- 旧表暂留用于迁移和回滚，业务路径不再读写它们。启动迁移检查阻止未完成迁移的实例静默丢失草稿。

## 自动验证

- `pnpm build`：通过。
- `pnpm check`：通过。
- `pnpm test`：domain 26、API 124、workbench 15，全部通过。
- `pnpm test:e2e`：16 项全部通过。
- workbench `format:check`、`git diff --check`：通过。
- 覆盖原文空白与 CRLF、增删文件、草稿持久化与丢弃、摘要陈旧、幂等提交、三方合并及冲突、部分选择导致缺失依赖时不移动分支、HTTP 授权与放弃、CLI 合并识别、迁移幂等和缺失分支恢复。

验证中修复了 macOS 临时路径包含系统符号链接时的误拒绝，以及大文件通过同步子进程 stdin 写入时发生的超时；大内容改用临时文件交给 Git 读取。旧的快进采纳断言已更新为检查合并提交及包含关系。其余新增测试的失败来自 fixture 文档 id 重复和创建接口应返回 201，已修正。

## 线上只读核对与副本演练

- 当前实例没有待迁移的 `om_workspaces`；旧个人草稿/Proposal 迁移预检也没有未完成项目。
- 历史贡献 `con_ea1c836af418dd68f358a26b` 已采纳，但 `contributions/` 分支实际缺失。历史提交 `8fd56ff88b4d2ea17e034987781c4adc4e907918` 仍在 main 中，包含完整的贡献 id、作者、来源、理由和基准 trailer。
- 理由、证据和所选路径与旧数据库逐字段核对一致。
- 只读预览明确报告 `restore-accepted-branch`。应用只恢复指向该历史提交的分支，不创建提交或改写历史。
- 在 `runtime/om-git-rehearsal-wPsOO2` 的仓库副本及 SQLite 一致性备份中完成演练；逐表逐行核对，原有业务记录完全不变，仅新增迁移收据。
- 所有原有 Git 引用保持不变，只新增上述贡献分支。重跑没有待迁移项目，Git 推导出的状态为已采纳。
- 加强迁移字段核对后，再次对线上执行只读预览，结果一致。

## 经授权正式切换

- 用户明确选择“现在备份、迁移并重启核验”后，核验原控制进程的 PID 和启动命令，以 SIGTERM 停止 Forge 与 CertLab；确认 4175、8000、5173 均无监听后备份。
- 完整备份位于 `runtime/om-git-deploy-backup-2026-10-20T15-17-55-794Z`，包含 project、data、ops 和工作台静态资源；SQLite 完整性检查通过。
- 正式迁移逐表逐行摘要核对通过，原业务数据完全不变，只新增 `om_legacy_migrations` 收据；外键检查没有违规。
- Git 仅补回指向 `8fd56ff88b4d2ea17e034987781c4adc4e907918` 的历史贡献分支，没有移动 main、个人分支或任何已有引用。
- 用原启动器重启，控制进程 PID 为 78104。Forge 健康端点、工作台、CertLab 健康端点和前端均返回 200；未认证的贡献和成效基线接口均返回 401。
- Git 推导出历史贡献已采纳，选定文件为 393 个。重启前后所有 Git 引用一致；再次只读预览没有待迁移项目。
- 备份目录下的 `before.json`、`after-migration.json`、`after-restart.json` 保存核对结果。未在生产创建测试贡献或测试草稿，未执行历史空白清理。

## 设计反思

本次实现的发现与修改路径完整可见；更早方案讨论仅有交接摘要，不据此推断过程。未来入口为 `PersonalOmChanges` / `ForgeUseCases`，通过领域端口进入 `GitOmWorkspaces` / `GitContributions`，迁移入口为 `scripts/migrate-personal-om.mjs`。

| 检查 | 结果 | 证据与后续风险 | 置信度 | 层级 |
| --- | --- | --- | --- | --- |
| Missing Path | not-found | 运行时、HTTP、fixture 和度量依赖通过端口与组合根找到。交接提及的 feature 文件在当前检出中缺失，已提供当前规格入口。 | 高 | 不适用 |
| Boundary Bypass | not-found | 授权、选择及校验顺序由 use case 负责；Git 读写和状态推导在适配器，业务路径不再使用数据库贡献状态。 | 高 | 不适用 |
| Unowned Capability | found | `git-om.ts` 与 `personal-git-om.ts` 仍有两个 Git 执行函数；本次大文件超时需要关注两条执行路径，后续错误处理可能再次不一致。`duplication-risk`。 | 高 | what-level |

最小建议：另行确认统一 Git 执行能力的归属和接口，再合并两个 helper。本次不新增抽象或修改项目指导文件。
