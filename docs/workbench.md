# AiricForge 工作台

生产前端位于 `apps/workbench/src`，使用 React、Material UI 和 assistant-ui。外部 `prototype/` 仅作设计参考；删除该目录不会影响构建和工作台功能。历史 MUI 验收见 `acceptance/mui-migration-record.md`；当前恢复记录见 `acceptance/workbench-restoration-record.md`。

## 构建与启动

在仓库根目录执行 `pnpm install --frozen-lockfile`、`pnpm build`，然后运行 API。前端构建到 `apps/workbench/public`；该目录是生成产物，不纳入 Git。API 默认从这里提供同源页面，无需独立前端服务。Docker 同样先构建工作台再复制静态产物。发布前必须先构建，不自动回退到只读简版。

`FORGE_WEB_DIST_DIR` 可显式指定产物目录的绝对路径。`/` 提供工作台，`/works` 和 `/works/:workId` 支持刷新及深链接，query 保留所有者、页码、类型、状态、Reflection 和引用事件定位。开发可执行 `pnpm --filter @airic-forge/workbench dev`，API 请求代理到 4175；Reflection 的写请求仍服从后端同源校验，完整浏览器验证使用 API 同源的构建页面。

## 页面与职责

- `src/workbench/WorkspaceApp.tsx`：登录、账户菜单、MUI 导航和按需加载。主导航提供工作台、个人 OM、Work 与轨迹、提议；管理员另有组织治理、能力目录、组织贡献、用户、实例设置、成效基线及 Lens 管理。
- `pages/WorkListPage.tsx` / `pages/WorkDetailPage.tsx`：报告名称、筛选、分页、Work 对话和 Reflection 入口，以及显式结果评价。
- `ReflectionChat.tsx` / `reflection-stream.ts`：连续 Reflection 对话、三种 Lens、SSE 快照、工具状态、停止、恢复和原请求 ID 核对。浏览器断开只移除观察者，运行由服务端管理；权限失效停止自动连接。状态通知在最新回复附近显示，不记录或渲染私有推理。
- `Conversation.tsx` / `trajectory.ts`：原始 Work 轨迹的展示投影。历史流式片段按 Turn 合并；完成 Turn 使用其最终回答；引用原片段时仍能定位到原事件。存储历史不改写。
- `ProposalReview.tsx` / `pages/ProposalsPage.tsx`：来源、归因、差异、结构/能力检查、过期基准 Rebase、显式确认采纳或放弃。Reflection 运行期间禁用治理写操作，服务端继续执行互斥检查。
- `pages/OmPage.tsx`：个人及组织 OM 树、固定版本阅读、结构化 WD、历史与私有草稿。草稿保存不改变 active HEAD。
- `api.ts` / `hooks.ts`：同源 Cookie、稳定错误、读取竞态和提交状态。组件不自行决定专业授权；后端用例是唯一权限和治理判定来源。

管理员可查看他人的 Work、Reflection、OM 和候选差异。发起/继续 Reflection、停止运行和采纳个人 Proposal 仍由原作者执行；界面明确显示只读原因。个人采纳和组织吸收走原有流程，不由界面代行。

普通问答不自动形成 Proposal；只有证据支持的 Lens 分析才可能形成候选。API Suggestion 可导出，但不会自动增加工具。Markdown 禁止原始 HTML、内嵌图片和不安全链接。

## 验证

`pnpm check`、`pnpm build`、`pnpm test` 覆盖领域、API 和工作台；`pnpm --filter @airic-forge/workbench format:check` 检查前端格式；`pnpm test:e2e` 使用 `scripts/acceptance/mui-browser-server.mjs` 启动隔离的真实 API、SQLite、Git 与轨迹存储，模型由确定性夹具代替，不使用业务数据库或外部模型。首次运行需安装 Playwright Chromium。

浏览器覆盖作者闭环、管理员只读、流式单消息、刷新恢复、停止、未知提交响应、证据跳转、草稿保留、Rebase、组织吸收、API Suggestion、初始密码、窄屏与管理页。截图和失败轨迹保存在 `apps/workbench/test-results`，不纳入 Git。
