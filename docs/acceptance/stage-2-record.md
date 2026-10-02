# 阶段 2 验收记录

状态：已完成。验收日期：2026-10-02。环境：本机 Docker AiricForge 镜像、独立临时 SQLite CertReporter、真实 Report 页面、浏览器、真实模型服务。测试 Report 与账户均为隔离夹具。

## 已验证

- **能力目录门槛：**管理员从 CertReporter 的 bearer 保护 manifest 与 OpenAPI 导入候选并接受。真实模型仅获得已接受且 `report-authoring` WD 允许的 `report.*` 工具。真实 Git/SQLite/JSONL 集成测试确认未接受目录禁止 Turn、目录 digest 变化禁止下一 Turn，旧 Turn 仍保存原 digest。
- **真实 Work 与命令：**Report 页面经 Forge bootstrap、ACP WebSocket 启动同一长期 Work `wrk_fc735b977a259b470c148b89`。模型两轮调用 `report.update-master`，CertReporter Report `23307cff-6fcd-4a06-aacf-fef58d668230` 从修订 1 到 3；两个命令回执均为 `committed`。Drawer 收到流式文本，在 Turn 期间锁定报告写控件，终态后刷新；未保存草稿阻止发送。页面切换再进入仍恢复同一 Work 与历史。
- **版本与来源：**Forge 工作台登录后读到上述 Work 的两个 completed Turn、相同 OM HEAD、已接受目录 digest、不同的 `report.context` digest、三个必需 WD 文档来源及每个 Action 的 pending/committed 记录。完整回执保留在可展开的原始记录中，默认展示简明摘要。
- **响应丢失：**`scripts/acceptance/stage-two-recovery.mjs` 在真实 CertReporter 命令提交后丢弃响应，并暂时隐藏首次回执查询。后续按原 `commandId` 查询得到 committed；轨迹依次为 pending、unknown、committed；只提交一次，Report 修订只增加 1。实测修订 4→5。
- **权限拒绝：**临时 bearer token 撤销前 Forge bootstrap 返回 201，撤销后返回 401；使用有效 token 请求另一 Report 返回 401。CertReporter 协议测试另覆盖跨 Report 数据写入、过期修订、非作者写入、他人查询/重放同一 `commandId` 的拒绝。
- **断线与重启：**Forge 容器重建、重启后旧 Work/Turn/Action 可从工作台读取；旧 ACP 连接不能继续发命令。Report Drawer 重新 bootstrap 后恢复历史并解锁写控件。Forge Web 内存会话重启失效，独立账户重新登录后仍能查看原 Work。
- **构建与测试：**领域测试 8/8、API 测试 13/13、CertReporter 协议测试 6/6；领域、API、工作台 TypeScript 检查及 Forge/CertReporter 前端生产构建通过。Docker Compose 镜像构建与运行通过。仓库 `git diff --check` 通过。

## 交付边界与后续

- 本阶段关闭 Report 页面 `report-authoring` 的 Work、ACP、受限命令、轨迹和恢复切片。Proposal、Reflection 与下一轮新 HEAD 归阶段 3–4；Forge 与 CertReporter 三份数据的备份/还原归阶段 5。
- 报告助手的 PDF/DOCX/TXT 附件尚未迁入 Forge；当前 Drawer 仅支持文本输入。旧 Airic sidecar 仍服务 Report Type 助手，因此全局移除其部署依赖留到阶段 5 的迁移核对，不能据此宣布 P0 完成。
- 本机演示使用临时 CertReporter 数据与测试账户，不能代表生产数据迁移验收。`scripts/acceptance/stage-two-recovery.mjs` 需要指向一次性测试 Report 的 JSON 夹具（`token`、`reportId`、`email`），会修改该测试 Report；不可对业务 Report 执行。
