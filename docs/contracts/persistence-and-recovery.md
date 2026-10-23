# 持久化与恢复契约

| 数据 | 事实来源 | 恢复要求 |
| --- | --- | --- |
| 用户、身份、Work/Session/Turn、Reflection Run、工具快照及索引 | Forge data/forge.sqlite | 保留身份/归属/原状态；运行中断不推定成功；工具快照和用户管理审计不可变 |
| 生效 OM、个人提交、组织贡献及来源 | Forge project Git | main、个人和贡献分支及所引修订均可读取 |
| 私有草稿与同步上下文 | data/worktrees/drafts 的文件和私有 Git 元数据 | 恢复增删文件、摘要、冲突及基准，不擅自提交 |
| 业务轨迹 | data/trajectories JSONL | 按事件 ID 去重；只隔离截断末行，保留之前完整证据 |
| Pi 会话与工作文件 | data/agent-workspaces | 保留原生消息/图像、显式绑定和笔记；缺失绑定文件明确失败 |
| App 业务记录、原命令事务和回执 | App 自身存储 | Forge 不复制或推定业务结果；按原 commandId 核对 |
| Secret | 独立部署机制 | 与数据备份分别保护；短期 App token 不持久化 |

SQLite、Git、JSONL 及 App 回执之间可能存在中间状态。恢复后保留 interrupted/unknown，不合成成功；未知命令阻止后续写入，不自动重放。重新进入 App 必须认证，Pi transcript 不能恢复业务授权。

新实例直接建立当前 SQLite 结构。代码不创建或读写旧 Proposal、数据库 OM 草稿/贡献及迁移收据表；已有运行数据库中的历史表和记录不删除。未升级的旧产品格式不在兼容范围内，不再提供旧转换脚本。

完整备份覆盖 OM、数据库一致性副本、轨迹、原生会话、工作文件、未完成草稿和关联 App 恢复点。原生会话含完整正文/图像，应按业务资料保护，不向前端或普通审计复制私有推理。切勿复制仍在写入的 SQLite 主文件而忽略 WAL。

当前进程重启会将运行 Turn/Reflection 标记为中断并完成用户停用收尾；已有资源保留。恢复测试使用临时目录和已有显式会话，不通过扫描“最近会话”猜测。

发布级协调备份/恢复入口和跨目录 Git worktree/Pi 路径修复仍待按 [App 集成需求](../app-integration.md)实现并演练。软件回滚、OM 撤销和数据恢复分别处理，不能只换镜像后声称数据库或 App 效果已回退。

## App 所有的离线组合快照

`forge-ops backup/verify/restore` 的实际命令与拒绝条件见 [部署手册](../deployment.md)。备份必须在停止 App/Forge 后进行，携带 complete App bundle，保存原生会话和工作文件。恢复只写全新目录，检查组织、部署身份、文件校验和及数据库完整性，修复 Git worktree 和原生会话头/显式绑定的路径；不改写业务历史或重放未决命令。依赖缓存可重建，Secret 单独保管。`deployment-state.test.ts` 验证个人草稿、原会话 ID、阅读进度及跨路径重开；软件降级不等于数据可降级。
