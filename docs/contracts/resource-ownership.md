# 资源关系与权限

每个实例显式绑定一个App和一个组织。Forge的admin/user角色只管理自身资源，不授予业务App的专业权限。

| 资源 | 关系与事实来源 |
| --- | --- |
| 用户与 App identity | 已验证 App 身份按规范化邮箱关联 Forge 用户；SQLite 保存关联与用户状态 |
| 个人 OM | users/<id> HEAD 为 active；Git 保存内容与历史 |
| Work 与会话 | 所有者、App、工作类型、业务对象绑定；业务长期会话与临时 ACP 连接分开 |
| Turn | 固定 OM、工具快照、App 上下文和来源；SQLite/JSONL 记录业务执行 |
| 原生 Pi 会话 | 按用户、Work/Reflection 和明确来源绑定，保存在运行数据中 |
| Reflection | 可关联有权访问的 Work，或为个人独立讨论；连续消息及 Run 持久化 |
| 私有 OM 草稿 | 所有者及 manual/sync/reflection scope 的 detached worktree；未确认不生效 |
| 组织贡献 | contributions/<id> 分支；来源、选择和状态由 Git 推导 |
| 工具快照 | 每 Turn 动态发现并不可变保存；只有来源语义，没有授权或审批语义 |
| API 建议 | 可导出的需求说明，不变为工具或 App 写权限 |

| 操作 | 所有者 | 其他普通用户 | Forge 管理员 |
| --- | --- | --- | --- |
| 读取个人 OM、Work、轨迹、Reflection 和草稿 | 允许 | 拒绝 | 按管理接口读取，保留真实所有者 |
| 修改或提交个人 OM、发起/继续/停止 Reflection | 允许 | 拒绝 | 不能冒充另一作者 |
| 管理组织贡献、用户和 Lens | 角色允许时 | 拒绝 | 允许，仍执行版本与审计规则 |
| App Query/Command | 当前已验证 App 身份发起，App 每次判断专业权限 | 不能借 Forge 访问他人业务 | 管理员身份本身不授予业务能力 |

用户停用、资源归属及最后管理员保护见 [用户管理](../user-administration.md)。网页上下文、模型判断和检查点反馈不是专业授权。外部 Git push 遵守同一所有者和 OM 校验，不改变历史 Turn。
