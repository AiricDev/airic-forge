# 阶段 3 验收记录

状态：已完成。验收日期：2026-10-02。环境：本机 Docker AiricForge、独立临时 CertReporter SQLite、真实 Report 页面和浏览器。测试账户与 Report 为隔离夹具。

## 已验证

- **个人编辑与治理：**工作台创建 Proposal `prp_ec508c37d927e16d95e70e72`，编辑 `work-definitions/report-authoring/policy.md`，查看来源、理由、证据、文件差异，校验后审阅并确认采纳。采纳前 active HEAD 为 `c85427d27f13fdf04dbf66f90910d9674bcc84d9`；采纳后为 Git merge commit `c74b0556afe24fc45c6130abc8ff9ff56defc744`。浏览器确认修改只在采纳后出现在当前 OM。
- **下一 Turn 与历史：**同一 Report Work `wrk_fc735b977a259b470c148b89` 的 Turn #1、#2 保留旧 OM 修订；采纳后的 Turn #3 使用新 HEAD，并在真实 CertReporter Report 页面完成只读问答。浏览器从版本历史打开旧主线修订，读到采纳前 policy，再返回当前修订读到新增内容。审阅候选提交不会误列为曾生效的 active 版本。
- **并发与冲突：**真实临时 Git/SQLite/JSONL 集成测试同时创建两条 Proposal，各有独立 worktree。第一条采纳后，第二条以旧 base 采纳被拒；rebase、重新校验审阅后才可采纳。冲突测试保留有冲突标记的文件供用户手动修改，再继续 rebase。重启后 Proposal 状态、Git HEAD 和旧 Turn 修订仍可读。
- **校验与权限：**候选审阅检查 WD 结构、已接受能力、文档引用、SK front matter、允许路径和实际改动。集成测试新增 SK 并由新 WD 引用；采纳后无需重启即可解析。无 front matter 的 SK 被拒。普通用户不能读写他人的 Proposal 或 OM；管理员可以只读查看。非个人主线的候选修订不能作为个人历史 OM 读取。
- **外部 Git：**对个人用户工作区直接提交后，下一 Turn 固定新的 HEAD；既有 Turn 仍保留原修订。
- **构建与测试：**领域测试 8/8、API 测试 15/15；领域/API/工作台 TypeScript 检查、工作台生产构建及 Docker Compose 重建启动通过。API 测试中的本机临时 HTTP/WebSocket 监听在允许回环网络后通过；`git diff --check` 通过。

## 边界

- 阶段 3 关闭个人 OM 编辑、审阅、采纳、历史、并发 rebase 和下一 Turn 版本切换。Reflection 的 lens、证据学习与 API Suggestion 属于阶段 4；部署备份还原和旧 sidecar 迁移核对属于阶段 5。
- 本机测试账户、测试 Report 和 Git 提交只作为验收证据，不代表生产迁移已完成。
