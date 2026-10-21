# AiricForge 工作台

账户角色、初始化、停用收尾及管理接口见 [用户管理契约](user-administration.md)。

生产前端位于 `apps/workbench/src`，使用 React、Material UI 和 assistant-ui。外部 `prototype/` 仅作设计参考；删除该目录不会影响构建和工作台功能。历史 MUI 验收见 `acceptance/mui-migration-record.md`；当前恢复记录见 `acceptance/workbench-restoration-record.md`。

## 构建与启动

在仓库根目录执行 `pnpm install --frozen-lockfile`、`pnpm build`，然后运行 API。前端构建到 `apps/workbench/public`；该目录是生成产物，不纳入 Git。API 默认从这里提供同源页面，无需独立前端服务。Docker 同样先构建工作台再复制静态产物。发布前必须先构建，不自动回退到只读简版。

`FORGE_WEB_DIST_DIR` 可显式指定产物目录的绝对路径。`/` 提供工作台，`/works` 和 `/works/:workId` 支持刷新及深链接，query 保留所有者、页码、类型、状态、Reflection 和引用事件定位。开发可执行 `pnpm --filter @airic-forge/workbench dev`，API 请求代理到 4175；Reflection 的写请求仍服从后端同源校验，完整浏览器验证使用 API 同源的构建页面。

## 本地设置或重置用户密码

由能访问实例数据目录的本机运维人员执行。先停止 Forge，并在仓库根构建：

```sh
pnpm build
pnpm user:set-password --email user@example.com
```

命令从根 `.env` 读取 `FORGE_DATA_DIR`，也可显式加
`--data-dir /absolute/forge/data`。默认隐藏输入密码并二次确认，至少 12 个字符；
不接受密码命令参数或密码环境变量。自动化可将秘密管理器的输出直接通过管道交给
`--password-stdin`，只接受一行 UTF-8（最多 4096 字节），不会回显。
不要把实际密码写进 shell 命令、历史、脚本或日志。

仅设置/重置已存在的 Forge 用户，不创建账号、不授予管理员、不修改 CertLab 密码，
也不初始化或迁移应用数据库。
用户须先通过 CertLab 连接 Forge 建立账号。完成后重启 Forge，再登录。
密码变更本身不撤销内存中的既有登录/ACP 会话；停服与重启使这些会话失效。

## 页面与职责

- `src/workbench/WorkspaceApp.tsx`：登录、账户菜单、MUI 导航和按需加载。管理员的成效基线位于整个导航最后；其余主导航提供工作台、个人 OM、Work 与轨迹、改进工作方式、本地 agent 与 Git，管理区提供组织贡献、用户、实例设置及 Lens 管理。不再设置组织治理汇总页。实例设置不再提供能力目录标签页；成效基线仍仅管理员可访问。
- `pages/AdminOverviewPages.tsx` 的实例设置：管理员只读查看实际 OM Git 仓库、运行数据及个人 worktree 根目录，以及集成 App、组织、MCP 地址和传输类型。Lens 管理独立于实例设置。配置接口 `/api/v1/instance-settings` 只返回明确允许展示的字段，不暴露密钥或完整运行配置。
- `pages/WorkListPage.tsx` / `pages/WorkDetailPage.tsx`：报告名称、筛选、分页、Work 对话和 Reflection 入口，以及显式结果评价。
- `ReflectionChat.tsx` / `reflection-stream.ts`：连续 Reflection 对话、三种 Lens、SSE 快照、工具状态、停止、恢复和原请求 ID 核对。浏览器断开只移除观察者，运行由服务端管理；权限失效停止自动连接。状态通知在最新回复附近显示，不记录或渲染私有推理。
- `Conversation.tsx` / `trajectory.ts`：原始 Work 轨迹的展示投影。历史流式片段按 Turn 合并；完成 Turn 使用其最终回答；引用原片段时仍能定位到原事件。存储历史不改写。
- `OmDraftReview.tsx`：提交前后差异、编辑、删除、丢弃、过期基准合并与直接确认提交。Reflection 运行期间禁用该讨论的草稿写操作，服务端继续执行互斥检查。
- `pages/ReflectionsPage.tsx` / `pages/GitAccessPage.tsx`：独立讨论及个人 Git 令牌创建、撤销和 clone 指引。
- `pages/OmPage.tsx`：个人及组织 OM 树、固定版本阅读、结构化 WD、历史与私有草稿。草稿保存不改变 active HEAD。
- `api.ts` / `hooks.ts`：同源 Cookie、稳定错误、读取竞态和提交状态。组件不自行决定专业授权；后端用例是唯一权限和治理判定来源。

管理员可查看他人的 Work、Reflection 和 OM。发起/继续 Reflection、停止运行和提交个人 OM 仍由原作者执行；界面明确显示只读原因。组织贡献治理保持不变。

普通问答不自动改 OM；用户明确要求即可准备草稿，Lens 可选。API Suggestion 可导出，但不会自动增加工具。Markdown 禁止原始 HTML、内嵌图片和不安全链接。Git 接入、部署和旧数据迁移见 [个人 OM](personal-om-changes.md)。

能力列表和输入输出定义来自配置 App 实例 `/mcp` 的标准 `tools/list`。Forge 规范化分页结果形成审核快照；管理员接受后目录才生效，WD 仍需显式允许能力。MCP 地址不附加访问令牌，直接访问需要 App 身份认证。旧 manifest/Agent OpenAPI 不再使用，切换步骤见 `certlab-integration.md`。

## 验证

`pnpm check`、`pnpm build`、`pnpm test` 覆盖领域、API 和工作台；`pnpm --filter @airic-forge/workbench format:check` 检查前端格式；`pnpm test:e2e` 使用 `scripts/acceptance/mui-browser-server.mjs` 启动隔离的真实 API、SQLite、Git 与轨迹存储，模型由确定性夹具代替，不使用业务数据库或外部模型。首次运行需安装 Playwright Chromium。

浏览器覆盖作者闭环、管理员只读、流式单消息、刷新恢复、停止、未知提交响应、证据跳转、草稿保留、Rebase、组织吸收、API Suggestion、初始密码、窄屏与管理页。截图和失败轨迹保存在 `apps/workbench/test-results`，不纳入 Git。
