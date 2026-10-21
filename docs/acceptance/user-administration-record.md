# 基本用户管理验收记录

日期：2026-10-21。功能契约见 [用户管理](../user-administration.md)。保留原有未提交改动，本次未创建提交；没有修改 CertLab 业务数据或权限。

## 自动验证

- `pnpm build`、`pnpm check` 通过；最后一次工作台刷新修正后，重新通过工作台 build、check 和测试。
- 工作台 `format:check` 通过，`git diff --check` 通过。
- `pnpm test`：领域 29 项通过，API 149 项通过、1 项既有测试跳过，前端 15 项通过。
- `pnpm test:e2e`：19 项全部通过。覆盖首管理员管理入口、详情与历史、角色调整、停用/恢复、冲突保留输入、自身降级、直接请求拒绝，以及停用中仅观察/停止已受理 Reflection。其余既有 OM、Work、Reflection、Git 与实例设置流程同时通过。
- API 使用真实 Git/SQLite/JSONL，验证 Turn 和 Reflection 成功、失败、主动取消三种停用收尾；并发首用户、最后管理员并发保护、受理/停用两种竞争顺序、请求重放、审计原子性、旧会话/票据/Git 令牌失效和重启收尾均通过。
- 浏览器测试发现管理员列表首次进入时可能显示旧缓存：现已在进入用户管理时刷新，并在该页面定期刷新任务收尾产生的状态变化；编辑对话框保留其原版本和输入。

## 当前实例升级

先确认无运行中的 Turn/Reflection，仅停止 Forge，保留 CertLab API、前端和 worker。备份在：

`runtime/backups/users-20261021-200202/forge-before-user-management.tar.gz`

同目录包含 SHA-256 校验、升级前资源基线、数据库副本演练结果和实际升级验证结果，目录不纳入 Git。归档完整保存 Forge 数据根目录及 OM 仓库；含原 linked worktree 路径，恢复时应使用原位置。

先在数据库副本应用结构升级，校验原有表资源及用户身份字段未变，再启动新 Forge 应用同一次性升级。当前 `certlab_admin@certlab.local` 为 `admin / active / version 1`，保留原用户 ID、密码、个人分支、1 条 App 身份关联和 2 个 Work。所有原有非用户表内容与 Git refs 的校验值不变，用户身份字段及密码 hash 的校验值不变。新增一次系统初始化审计；本地邮箱白名单配置已移除。

Forge 仍在 `http://127.0.0.1:4175` 提供服务。`/health`、根页面、静态脚本、Work 与 Reflection 深链接均返回成功；未登录的身份和用户管理接口返回 401。重启清除了旧内存会话，当前用户需用原独立密码重新登录；初始管理员的组织 OM 管理入口已由独立浏览器数据验收。

## 变更后的设计反思

观察覆盖：当前实现、测试修正和上线过程可见；早期规划与首次定位过程经过上下文压缩，无法完整复原，相关路由判断标为 unknown。没有为反思额外重建历史。

修改闭包：账户规则与受理策略位于 `packages/domain/src/user-administration.ts`；AccountPort 对接 SQLite 的版本、初始化、审计事务；API runtime 负责凭据撤销和连接生命周期；用户页面及工作台当前身份刷新负责呈现。后续账户变更应沿这条路径，同时查看用户管理契约与对应 API/浏览器测试。

| 检查 | result | evidence | future-risk | confidence | level |
| --- | --- | --- | --- | --- | --- |
| Missing Path | unknown | 早期定位轨迹被压缩；当前闭包和验证入口已在契约列明 | 无法据现有轨迹判断早期是否存在漏查入口 | low | — |
| Boundary Bypass | not-found | SQLite 在同一事务调用领域规则并提交审计；受理协调经 AccountPort；凭据撤销由 runtime 绑定；页面直接请求越权有反例测试 | 后续新增受理入口仍需使用同一账户级受理策略 | medium | — |
| Unowned Capability | not-found | 账户策略、持久化、凭据生命周期和页面各有上述现有归属；真实任务与数据库测试覆盖交接 | 若引入多进程，需要重新决定运行中任务受理的共享所有权 | medium | — |

当前观察范围内没有发现需要另行处理的路由问题。不修改架构指引或技能；本次不增加多进程运行模型。
