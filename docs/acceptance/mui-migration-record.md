# Material UI 工作台迁移验收

历史记录：本文中的 `prototype/` 生产代码已于 2026-10-19 恢复到 `apps/workbench/`；当前构建入口和验收见 [恢复记录](workbench-restoration-record.md)。

日期：2026-10-14（Asia/Shanghai）。本次完成全部真实 AiricForge Web 工作台页面迁移，不包含业务 App 的嵌入式 Copilot，不发布正式部署。

## 实现结果与边界

- 使用 Material UI 9.5.0、Material Icons、默认 Emotion 引擎、Community RichTreeView 9.15.0；React/ReactDOM/react-is 保持 18.3.1。主题仅增加中文字体回退和控件文案，保留默认浅色设计语言。
- Roboto Latin 字体随应用发布；页面使用 MUI 标准 AppBar、Drawer、表单、Table、Pagination、Tabs、Chip、Accordion、Dialog、Alert、Snackbar。手机收起辅助 ID 与时间列，资源详情仍可读取完整信息。
- 生产入口与历史原型分开：`StageOneApp` 仅转发真实工作台；页面独立拥有读取、编辑和提交状态；HTTP 客户端及响应类型集中管理。生产不加载旧设计系统和 Tailwind CSS。
- 每页提供加载、失败、重试和空状态。旧读取响应不会覆盖新选择，写入期间避免重复提交。提交失败保留输入，确认框在成功后关闭；未保存离开支持继续编辑和放弃修改，浏览器返回同样受保护。
- Work 地址、查询参数、服务端分页、认证、业务权限、ACP、持久化及领域 API 均保持兼容。草稿不改变 active HEAD；Reflection Proposal 只读审阅；过期基准必须 rebase 并重新审阅。
- Git 明确纳入真实前端源码、配置和测试，原生成界面仍在本机作为被忽略的历史参考。构建产物、依赖、浏览器失败轨迹与业务运行数据继续被忽略。

## 自动化验证

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 通过；领域、API 与真实前端均进行类型检查 |
| `pnpm build` | 通过；真实前端仍输出 `prototype/dist`，页面按需加载 |
| `pnpm test` | 通过；领域 9、API 25、前端 8 项 |
| 前端 `format:check` | 通过 |
| `pnpm test:e2e` | Chromium 11/11 通过，最终运行约 25 秒 |
| `docker build -t airicforge:mui-workbench .` | 通过；本地验收镜像已更新 |
| `git diff --check`（含已暂存内容） | 通过 |

所有命令在 Node 24、项目指定 pnpm 10.18.2 下执行。前端脚本纳入工作区检查；API 测试所需的本机监听与浏览器验收在获准环境中执行。

## 行为与测试映射

| 场景 | 证据 |
| --- | --- |
| 凭据、JSON Header、204 响应、稳定错误与 HTTP 状态 | `prototype/src/workbench/api.test.ts` |
| 读取竞态与重试；401 身份过期与 503 读取故障区分 | `prototype/src/workbench/interactions.test.tsx` |
| 重复提交防护；失败后重试；输入保留与密码确认 | 同上 |
| 未保存取消/放弃与焦点恢复；采纳失败留在 Dialog；Reflection 无文件编辑器 | 同上 |
| 45 个 Work 分页、筛选回第一页、详情刷新与返回位置 | `prototype/e2e/workbench.spec.ts`：pagination 场景 |
| 引用定位较早 Turn、恢复 Reflection、只读 Proposal 校验与真实采纳 | 同上：citations 场景 |
| RichTreeView 键盘导航、草稿持久化与 HEAD 不变、离开确认 | 同上：OM drafts 场景 |
| 读取重试、Reflection 模型夹具失败保留输入、显式结果评价 | 同上：failed reads 场景 |
| 接受目录失败保留确认框，取消后恢复焦点，管理页截图 | 同上：catalog failure 场景 |
| 组织贡献真实审阅和吸收，成员同步产生独立 Proposal | 同上：organization 场景 |
| 普通用户缺少管理入口，跨所有者 API 返回 403，390px 窄屏无页面溢出 | 同上：ownership 场景 |
| 过期 Proposal rebase 后重新审阅，放弃后 HEAD 不变 | 同上：stale Reflection 场景 |
| API Suggestion 可导出且不创建 OM Proposal | 同上：API Suggestion 场景 |
| 浏览器 Back 中取消保留编辑，放弃后才导航 | 同上：browser Back 场景 |
| 一次性初始密码票据设置密码、移除 URL 票据、随后真实登录 | 同上：initial password 场景 |

浏览器测试启动真实 API，使用新建 SQLite、Git 与 JSONL 轨迹目录；模型 adapter 是测试专用确定性实现。503 读取和目录提交错误由浏览器注入，其余权限、草稿、版本、采纳和组织治理经过真实 API、领域用例与 Git。每次运行分配独立票据文件，正常退出通过 SIGTERM 关闭服务并清理；异常中断的临时目录不被后续运行复用。没有业务数据库写入或生产账号操作。修复临时票据碰撞后，同一端口再次独立启动并复测初始密码场景，1/1 通过。

## 逐页视觉证据

20 张 PNG 已逐页检查。检查文字、控件尺寸、表格与文档排版、响应式导航、字体与遮挡；截图等待加载和抽屉关闭，并关闭动画，避免保存过渡帧。

| 页面 | 截图 |
| --- | --- |
| 登录（桌面/手机）与初始密码 | [登录](mui/login.png)、[手机登录](mui/login-mobile.png)、[初始密码](mui/password-setup.png) |
| 工作台 | [Dashboard](mui/dashboard.png) |
| Work 列表（桌面/手机） | [列表](mui/work-list.png)、[手机列表](mui/work-list-mobile.png) |
| Work 详情与 Reflection | [轨迹](mui/work-detail.png)、[Reflection](mui/reflection.png) |
| Proposal 列表与审阅 | [列表](mui/proposals.png)、[审阅](mui/proposal-review.png) |
| API Suggestion | [导出建议](mui/api-suggestion.png) |
| 个人与组织 OM | [个人](mui/personal-om.png)、[组织](mui/organization-om.png) |
| 组织治理与贡献 | [治理](mui/governance.png)、[贡献](mui/contributions.png) |
| 能力目录、用户、设置 | [目录](mui/catalog.png)、[用户](mui/users.png)、[设置](mui/settings.png) |
| 成效基线与 Lens 管理 | [基线](mui/measurements.png)、[Lens](mui/lenses.png) |

## 完成后职责检查

当前任务的入口查找、原型/真实工作台区分、页面拆分、请求集中与验证过程仍可回溯；没有额外重建历史日志。修改闭包为真实前端、包/锁文件、测试夹具、构建上下文及配套文档。后续修改从 `prototype/README.md` 的责任索引进入对应页面，再追踪 HTTP 客户端和已有服务端用例。

| 检查 | 结果 | 当前任务中的证据与后续风险 | 置信度 / 层级 |
| --- | --- | --- | --- |
| Missing Path | found，已修复 | 原型与真实入口共处且整个目录被 Git 忽略，容易让后续修改漏交付前端；现在真实入口、页面责任和追踪范围明确，历史参考保持隔离 | high / how-level |
| Boundary Bypass | not-found | 生产页面通过统一 HTTP 客户端调用既有 API；未修改服务端授权、草稿或版本治理。模型替换和低层数据播种仅存在于明确标记的隔离测试夹具 | high / — |
| Unowned Capability | not-found | 页面拥有业务呈现状态；账户和导航由入口负责；读取/提交机制及未保存提示集中管理；授权和治理继续归服务端 | high / — |

没有待处理的职责或边界决策。本次没有创建新的通用组件库、领域服务或状态管理框架。

## 验证限制

这里验证的是前端迁移、交互与既有接口兼容，不是新的真实模型评估、联合业务 App 验收、生产负载或正式部署发布。完整无障碍认证、所有浏览器组合和大数据量性能不在本次声明中。
