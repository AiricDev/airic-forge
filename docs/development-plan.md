# AiricForge 当前开发计划

状态：2026-10-23。只保留当前实现与下一步交付，不维护过时阶段清单。产品语义见 [PRD](airic-forge-prd.md)，具体需求见 [App 集成与交付](app-integration.md)，开发 Agent 使用 [集成 Skill](../skills/airic-app-integration/SKILL.md)。

## 已有基础

| 范围 | 当前行为 | 验证入口 |
| --- | --- | --- |
| CertLab 接入 | 当前用户 MCP、报告/组织绑定、原命令回执和未知结果恢复 | certlab-contract、work-execution、work-lifecycle、acp-socket 测试 |
| 原生 Agent | Pi 持久化会话、压缩、文件工具、明确 Skills 与 MCP/tool_search；Work/Reflection 分开 | pi-native-session、pi-reflection-scope、pi-work-agent-response 测试 |
| 个人 OM | Git 私有草稿、显式确认、并发合并、原生 Git 接入 | personal-om、om-git-state、personal-git-http 测试 |
| 组织治理 | 固定来源、按文件三方选择、验证后合并、成员主动同步 | organization-governance、organization-git-patch、om-history 测试 |
| 身份与收尾 | 首用户管理员、实际权限、停用中排空、审计与凭据撤销 | user-administration、access-control、reflection-stream 测试 |
| 工作台 | MUI、连续对话、草稿审核、组织贡献、用户管理 | Workbench unit 和 Playwright |

已有真实 Pi/资料验收见 [原生执行记录](acceptance/pi-native-record.md)。它证明当时受验范围，不替代新交付方案的部署验收或专业接受。

## 已实施的集成切片

固定边界：通用 PDF 阅读归基础 Agent；组织 OM 只管理业务逻辑。Agent 配置随代码发布，生效 OM 独立演化。Docker 用于发布，本机源码联调无需 Docker build。

| 顺序 | 切片与所有者 | 完成门槛 |
| --- | --- | --- |
| 1 | Forge config、Pi 资源适配器和 App 配置 | 原生包加载、显式只读配置、依赖诊断、实际资源身份、Work/Reflection 分离 |
| 2 | App 联调入口、Forge watch/重载与会话关联 | 无需镜像构建观察源码/Skill 修改；版本可见；独立数据/进程管理；安全重启后续接 |
| 3 | 通用阅读能力包、seed 与用户分支治理 | 跨领域图文 PDF 接续；OM 中通用操作细节迁出；不自动合并组织 main |
| 4 | App MCP/嵌入入口与 Forge 用例 | 身份、对象、真实草稿回执、权限拒绝、断连取消和未知结果恢复 |
| 5 | 初始化、App 构建与发布装配 | 新组织初始化幂等；新种子不覆盖 active；本地与镜像采用相同契约 |
| 6 | 发布、持久化与运维入口 | 组合兼容、升级备份、回滚限制、跨目录会话/工作树修复和恢复演练 |

[16 个行为场景](acceptance/app-integration.feature)覆盖 I-01～I-12；现有配置、联调、初始化和恢复入口见 [部署手册](deployment.md)，测试与运行边界见 [本轮记录](acceptance/app-integration-record.md)。Docker 镜像执行验收仍须在有 Docker daemon 的发布环境完成。

## 验证与变更闭包

先验证拥有行为的 Domain/use case/adapter，再做真实 HTTP/MCP、Workbench 与浏览器联调。确定性模型和合成资料优先；真实客户资料外发须授权。每项记录修改→观察生效的步骤和耗时，不虚构性能目标。

新增能力同时更新配置、资源装配、身份关联、必要 UI 诊断和验收；业务权限保持在 App。OM 变化更新格式/引用/治理及样例；会话或存储变化更新备份恢复契约。不要只交付单层实现。

仓库清理删除了过时部署、种子、迁移链和未使用入口，保留有效测试及不可变运行历史；范围和本次验证见 [清理记录](acceptance/repository-cleanup-record.md)。
