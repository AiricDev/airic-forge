# P0 持久化与恢复契约

这是阶段 2 和阶段 5 的实现及验收约束；当前 JSONL adapter 尚未完成全部恢复行为。

| 数据 | 事实来源 | 恢复要求 |
| --- | --- | --- |
| 用户、App identity、Work/Session/Turn、Reflection、Proposal 元数据 | /data/forge.sqlite | 重启不重复建号或丢失归属；未完成 Turn 不推定成功 |
| OM 内容、个人 active HEAD、Proposal base 与候选提交 | /project Git | 分支 HEAD 与所引文档可读取；未提交 Proposal 工作区保留在 /data |
| 规范化轨迹事件 | /data/trajectories JSONL | 完整事件按 ID 去重；最后一行若被截断，只隔离该行，不丢弃之前完整事件 |
| Pi 会话与临时工作区 | /data | 能读取既有工作；重启后的 App 命令必须重新 bootstrap 获得当前 token |
| CertReporter Report、命令事务与回执 | CertReporter 自身数据 | Forge 不复制业务事实；结果未知时以原 commandId 查询回执 |

写入顺序必须保留可恢复的中间状态。SQLite 中存在 Turn 而 JSONL 缺少完成事件，或 JSONL 存在 Action 而尚无最终回执时，恢复后呈现 running 或 unknown，不得合成成功。重放 JSONL 时按事件 ID 去重；历史 Turn 的 OM 修订和来源清单不可因当前 HEAD 变化而改写。

备份必须覆盖 Forge /project、Forge /data 与 CertReporter 自身数据，并记录三者的同一恢复点。恢复验收要重新打开旧 Work、旧 Turn、未完成 Proposal 和对应 App 回执；仅检查目录存在不算通过。App bearer token、ACP 连接票据与模型私有推理不进入备份。
