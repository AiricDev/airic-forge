# Forge 账户与用户管理

账户由业务 App 的已验证身份建立，按规范化邮箱关联既有 Forge 用户；不提供独立注册或邀请。Forge 的 `admin/user` 角色不影响 CertLab 的业务权限。

## 初始化与持久化

新实例的首用户在 SQLite `BEGIN IMMEDIATE` 事务内判断并创建为管理员，其后用户默认普通用户。当前 schema 直接包含 users.status（active/draining/disabled）、递增 version 和不可修改、不可删除的 user_admin_events。重启不扫描最早用户补授权限；不存在历史账号自动提升或旧格式转换。部署无需管理员邮箱白名单。

只有正常管理员可调整角色或停用/恢复，必须填写原因。不能降级或停用最后一个正常管理员，包括自身操作。数据库在同一短写事务内重读操作者、目标和正常管理员数量，检查版本、提交角色/状态及审计。审计保存操作者、目标、原因、前后角色/状态/版本及时间，不保存密码、hash、App Token 或会话凭据。

## HTTP 契约

均使用 Forge 网页会话，管理写请求执行同源校验。

| 接口 | 结果 |
| --- | --- |
| `GET /api/v1/users` | `{users}`；每个用户含 `id,email,role,status,version,passwordConfigured,activeBranch,createdAt` |
| `GET /api/v1/users/:id?page=1` | `{user,identities,history,page,total}`；关联身份含 `appId,appUserId,email`；历史倒序，每页 20 条 |
| `PATCH /api/v1/users/:id` | `{expectedVersion,requestId,reason,role?,enabled?}` → `{user}`；至少修改 role 或 enabled |

`expectedVersion` 为非负整数，`requestId` 为 8–100 位字母/数字/下划线/短横线，原因非空且最多 2000 字符。相同操作者和请求标识的相同输入重试返回原角色/状态/版本，不增加审计；不同输入返回冲突。当前权限仍会重新检查，自身降级后不能通过重放恢复管理权限。旧停用请求的重放不会再次撤销恢复后的新会话。

| HTTP | error |
| --- | --- |
| 400 | `InvalidUserChange`、`InvalidUserPage` |
| 401 | `Unauthorized`（无有效会话） |
| 403 | `Forbidden`、`UserUnavailable`、`UserDraining` |
| 404 | `UserNotFound` |
| 409 | `UserVersionConflict`、`UserRequestConflict`、`LastActiveAdministrator`、`UserStillDraining` |

## 停用和任务收尾

账户级受理锁覆盖新 Turn、Reflection Run 的受理与停用判定，不占用模型运行期间的 SQLite 事务。当前部署沿用单进程会话/任务运行模型；不支持多个 Forge worker 共享运行中的任务。

- 没有已受理任务：直接已停用，撤销网页会话、App 会话和待使用密码票据，关闭 ACP 连接。
- 有已受理任务：进入停用中，禁止新登录、bootstrap、连接、新任务、检验点继续和其他修改；既有会话只能观察当前任务或停止它。正在执行的任务仍可完成其原先受理的操作，业务结果不回滚。
- 所有已受理任务成功、失败或取消后，状态变为已停用、版本递增并记录系统审计，撤销会话和票据。Reflection 流在终态关闭，ACP 发送最终结果后关闭。
- Git 令牌在停用事务内撤销。恢复不复活令牌、票据或会话，需要重新登录或从业务 App 连接。停用中必须等待收尾或主动停止后才能恢复（`UserStillDraining`）。
- 重启使用既有运行中断规则，将旧任务标为中断，再完成停用中用户的停用。用户、身份关联、OM、Work、轨迹、历史均保留。

## 工作台与上线

“用户与资源”提供邮箱搜索、角色/状态筛选、密码是否已设置、角色和状态管理、身份关联及分页审计。变更必须填写原因；版本冲突保留输入，显式放弃并重读后才能以新版本提交。请求结果不确定时按原请求标识核对/重试。自身降级后立即移除管理入口，服务端对每次管理请求重新授权。不提供邮箱修改、删除、网页重置密码；本地密码维护见 [工作台说明](workbench.md)。

升级前停止接收任务并备份完整 Forge 数据与 OM。当前结构可保留身份、分支和资源继续启动；未升级的旧产品结构不在兼容范围内。切换、存储及恢复要求见 [恢复契约](contracts/persistence-and-recovery.md)。

## 验证入口

- `apps/api/src/user-administration.test.ts`：首用户并发、重启不提权、权限、最后管理员并发保护、版本/重放、审计事务和不可变性、会话撤销/恢复、重启。
- `apps/api/src/work-execution.test.ts`：真实 Turn 在停用中的成功、失败、主动取消，以及新 bootstrap/Turn/检验点拒绝。
- `apps/api/src/reflection-stream.test.ts`：真实 Reflection 在停用中的成功、失败、取消与会话收尾。
- `apps/workbench/e2e/users.spec.ts`：初始管理员入口、角色/停用/恢复、冲突保留输入、详情历史、自身降级及直接请求拒绝；测试仅使用一次性 SQLite/Git 数据。
