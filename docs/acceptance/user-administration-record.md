# 用户管理验证范围

当前规则见 [用户管理](../user-administration.md)。新实例首用户通过事务创建为管理员；打开已有数据库不补授角色或重写审计。账户变更、最后管理员保护、版本和请求重放、审计不可变、停用中任务排空及会话撤销均属当前行为。

## 维护中的验证入口

- user-administration.test.ts：并发首用户、重启不提权、账户权限、版本、幂等、原子审计、最后管理员并发保护、停用和收尾。
- work-execution.test.ts、reflection-stream.test.ts：已受理 Turn/Reflection 的成功、失败和取消，以及停用后拒绝新任务。
- apps/workbench/e2e/users.spec.ts：用户角色、停用/恢复、冲突输入保留、自身降级和直接请求授权。

2026-10-23 当前清理后的全量执行结果见 [仓库清理记录](repository-cleanup-record.md)。验证使用临时数据，不表示对运行实例进行了升级或账号修改。
