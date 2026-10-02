# P0 资源关系与权限矩阵

本契约适用于首个 App certreporter 和 Work Type report-authoring。CertReporter 拥有报告 Business State 和业务授权；AiricForge 拥有下列工作与 OM 资源。Forge 管理员权限不产生 CertReporter 的业务权限。

## 对象关系

| 对象 | 归属和关系 | 持久化位置 |
| --- | --- | --- |
| ForgeUser | 规范化 Email 唯一；一个用户可关联多个已验证 App identity | Forge /data SQLite |
| AppIdentity | (appId, appUserId) 指向一个 ForgeUser；首版仅 certreporter | Forge /data SQLite |
| 个人 OM | 每个用户一个 users/{userId} 分支及工作区；分支 HEAD 是下一 Turn 的 active 修订 | Forge /project Git 和 /data worktree |
| Work | 由 (ownerUserId, appId, workType, entityId) 查找未结束实例；结束后同键可创建新 Work | Forge /data SQLite |
| Session | P0 每个未结束 Work 自动恢复一个长期 Session；ACP 连接可重建，Session ID 不变 | Forge /data SQLite；App token 只在 ACP 进程内存 |
| Turn | 属于一个 Work；固定 OM HEAD、能力目录 digest、权威投影 digest 和实际加载文档来源 | Forge /data SQLite 与 JSONL |
| Reflection | 属于一个 Work 和用户；一个 Work 可有多个 Reflection | Forge /data SQLite 与 JSONL |
| Proposal | 至多属于一个 Reflection；有独立分支、worktree 和 base HEAD；Reflection 允许没有 Proposal | Forge /data SQLite 与 Git |
| API Suggestion | Reflection 的可导出富文本结果；不进入能力目录 | Forge /data |
| 能力目录 | App 发布候选；Forge 管理员接受指定版本后才可用于工具注册，WD 仍须显式允许 | Forge /data |

## 资源授权

| 行为 | 所有者 | 其他普通用户 | Forge 管理员 | CertReporter 最终检查 |
| --- | --- | --- | --- | --- |
| 读取个人 OM、Work、Session、Turn、轨迹、Reflection、Proposal | 允许 | 拒绝 | 允许；读取不改变模型所有者 | 无 |
| 修改个人 OM Proposal、审阅并采纳 | 允许 | 拒绝 | 可管理用户资源；须保留原所有者和来源 | 无 |
| 结束 Work、发起 Reflection | 允许 | 拒绝 | 可管理用户资源；不得冒充 App 业务身份 | 无 |
| 导入/接受能力目录、配置三种内置 lens | 拒绝 | 拒绝 | 允许 | 无 |
| 通过 report.* Query/Command 读取或修改 Report | 仅当前已验证 App 身份可发起 | 不得借 Forge 资源访问 | Forge 管理员身份本身不授予能力 | 每次基于 bearer token、目标报告、业务权限、状态和版本重新判断 |

浏览器传入的 Email、页面文本、Report ID 和选择位置都不是授权证明。Bootstrap 先验证 bearer token 对应的 App 身份，再用 report.context 验证当前报告；选择位置仅为聚焦提示。跨用户资源读取在 Forge 服务端拒绝。外部 Git 提交改变用户 active HEAD，但不会更改任何历史 Turn 的引用。

Email 更换或同一 App identity 指向不同规范化 Email 的迁移规则仍属后续身份生命周期议题；P0 不自动转移既有资源。
