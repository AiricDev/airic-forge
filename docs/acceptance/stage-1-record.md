# 阶段 1 验收记录

状态：已完成。验收日期：2026-10-02。环境：本机 Docker daemon、独立临时 `/project` 与 `/data` 绑定目录、AiricForge 生产镜像、容器内 CertReporter 协议夹具、本地浏览器。

## 已验证

- 空目录与既有目录启动：生产镜像构建成功；容器初始化 `/project` 的组织 `main` 与个人分支、`/data` 的 SQLite；同一数据目录在容器重启后可继续读取。
- 账户关联：容器内 App 协议夹具为 Alice、Bob、管理员签发身份；Email 规范化后重复 bootstrap 得到同一用户与长期 Work；同一个 App 身份不能静默改绑另一用户。重启后用户 ID、密码、Work ID 和个人 HEAD 保留。
- 资源权限：未登录访问个人 OM 返回 401；普通用户读取另一用户 OM 和管理员用户列表返回 403；管理员查看另一用户 OM 时仍返回原所有者。
- 浏览器：容器重启后管理员独立登录，列出用户并读取 Bob 的 OM；新用户 Charlie 使用协议夹具产生的一次性票据在工作台设密，地址栏票据随成功提交清除，随后登录并读取个人 `work.yml`。[浏览器截图](stage-1-browser.png)。页面由真实 API 提供，当前入口不使用原型的 `DemoContext` 或 `localStorage`。
- 首次设密：服务端票据的单次使用与过期已有测试；浏览器在票据过期时显示错误，在新票据下设密成功。修复了同一标签页跳转到设密链接时未更新页面的问题。
- 构建检查：领域/API TypeScript、当前工作台 TypeScript、API 测试、Vite 生产构建、Compose 配置解析及 Git 差异检查通过。旧原型页面仍在源码中，但不在生产入口的类型检查图中。

## 后续阶段的验收边界

- 真实 CertReporter Report 页面到 Forge bootstrap、ACP、业务命令与 Drawer 刷新属于阶段 2；本阶段的 App 身份测试使用容器内协议夹具。
- 备份与还原 Forge 双目录及 CertReporter 自身数据属于阶段 5；本阶段只验证同一双目录绑定在容器重启后恢复。
