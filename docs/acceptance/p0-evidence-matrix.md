# P0 验收证据矩阵

本矩阵引用可复查的阶段记录。编号沿用 PRD；P0-14 原文缺号。阶段 5 总门槛仍以 `stage-5-record.md` 的未通过项为准。

| 场景 | 当前证据 | 结果 |
| --- | --- | --- |
| P0-01 空实例与持久目录 | 阶段 1：空 `/project`、`/data` 镜像启动、已有目录重启；阶段 5：同机双容器从空 Forge 目录启动、真实 Report 命令及联合恢复 | 通过 |
| P0-02 App 新用户关联 | 阶段 1：App 协议夹具、个人 branch/worktree；阶段 2：真实 Report bootstrap | 通过 |
| P0-03 重复进入与独立登录 | 阶段 1：Email 规范化、设密与 HttpOnly 登录；阶段 2：同一 Work 恢复 | 通过 |
| P0-04 伪造身份与跨用户资源 | 阶段 1：401/403；阶段 2：失效 bearer 与跨 Report 拒绝 | 通过 |
| P0-05 管理员与业务权限分界 | 阶段 1：管理员只读他人 OM 不改变归属；阶段 2：App 业务拒绝 | 通过 |
| P0-06 能力目录 | 阶段 2：manifest/OpenAPI 导入与接受、WD 白名单；阶段 4：API Suggestion 不入目录 | 通过 |
| P0-07 App Work 与 ACP | 阶段 2：真实 Report Drawer、流式状态、长期 Work | 通过 |
| P0-08 命令与回执 | 阶段 2：真实 `report.update-master` 提交、页面刷新与 App 回执 | 通过 |
| P0-09 页面切换、撤销与跨目标 | 阶段 2：同 Work 恢复、bearer 撤销和另一 Report 拒绝 | 通过 |
| P0-10 未知命令结果 | 阶段 2：响应丢失后按 `commandId` 恢复且修订只增一次；阶段 5：恢复后的 App 可查原回执 | 通过 |
| P0-11 两用户独立 OM | 阶段 1：独立 branch/worktree；阶段 3：独立 HEAD 与资源权限 | 通过 |
| P0-12 草稿与外部提交 | 阶段 3：未采纳不生效、外部 active Git 提交从下一 Turn 生效 | 通过 |
| P0-13 审阅与采纳 | 阶段 3：结构、引用、能力、路径校验和带来源合并提交 | 通过 |
| P0-15 并发 Reflection/Proposal | 阶段 4：独立 worktree；阶段 3：过期 base 拒绝、rebase 后重新审阅 | 通过 |
| P0-16 三 lens | 阶段 4：真实三 lens、管理员版本化提示和审阅结果 | 通过 |
| P0-17 无证据与 API 建议 | 阶段 4：不创建空 Proposal；API Suggestion 导出且不变更工具目录 | 通过 |
| P0-18 运行中版本快照 | 阶段 3：采纳后下一 Turn 新 HEAD；阶段 4：按需 SK 来源记录 | 通过 |
| P0-19 Work 与来源 | 阶段 2：Work/Turn/Action/回执与 Context 文档；阶段 4：Reflection 来源 | 通过 |
| P0-20 持久化恢复 | 阶段 5：三份数据联合快照、隔离还原、旧 Turn 和原 App 回执；隔离测试含未完成 Proposal | 通过 |
| P0-21 浏览器个人闭环 | 阶段 4：Report → Work → 三 lens → Proposal 审阅采纳 → 下一 Turn 加载新 SK；API Suggestion 下载 | 通过 |

P0 功能场景的现有证据不能替代整体发布验收。同机 Compose 新环境、旧 sidecar 依赖退出和报告附件范围仍在阶段 5 记录中开放。
