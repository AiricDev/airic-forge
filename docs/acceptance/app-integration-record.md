# App 所有的 Forge 装配验收

日期：2026-10-23。本记录区分源码工程验证、真实本机联调和未执行的发布验收。规格见 [App 集成](../app-integration.md)，命令见 [部署手册](../deployment.md)。没有自动执行客户资料评估或修改现有专业报告。

## 已交付与证据

| 范围 | 实现与验证 |
| --- | --- |
| I-01 通用阅读 | pdf-reading Skill 不包含认证判断或 CertLab 工具名；museum/maintenance 两类合成资料使用同一原生机制，图文来源、笔记、重开、一次保存通过 generic-reading.test.ts。确定性模型只证明链路，不证明视觉理解质量。 |
| I-02 / I-05 / I-08 业务边界 | 保留 AppPort、MCP、报告绑定、权限拒绝及原回执核对；certlab-contract、work-execution、work-lifecycle、acp-socket 等回归通过。shutdown 新增活动任务排空和拒绝新执行覆盖。 |
| I-03 / I-04 资源 | agent-resources.test.ts 验证原生包扩展实际加载、显式 Skill、宿主资源排除、Work/Reflection 分离、资源冻结、配置变化切换会话并保留笔记；未固定版本、缺文件/程序、运行中准备依赖均拒绝。 |
| I-06 初始化 | forge-ops.test.ts 验证先准备再初始化、完整 seed 校验及来源提交、重复执行和新 seed 不覆盖个人 OM。App 代码拥有自己的 operating-model-seed；Forge seed 只保留测试夹具。 |
| I-07 / I-09 会话及治理 | pi-native-session.test.ts 使用实际 Pi 执行、延迟 MCP、自动压缩、工作文件、同一会话重开和草稿保存；Reflection 原生文件与治理候选稿回归通过。 |
| I-10 本机反馈 | App 所有的 forge-dev.mjs 无需 Docker 即可增量构建、启动、状态、重启、停止；占用端口不影响原服务，工具回归2项通过。Forge 源码需明确 restart，App/Vite 使用自身热更新。 |
| I-11 发布 | App Dockerfile 基于固定 Forge 镜像，原生 prepare/check；发布入口拒绝未固定基础镜像，不推送；Compose 组合和独立卷已提供。实际容器验收未执行，见下文。 |
| I-12 恢复 | deployment-state.test.ts 校验文件、数据库、部署身份，恢复个人未完成草稿、原生会话 ID 与笔记，修复不同路径和 macOS 等价路径。活跃锁、已有目标、不同版本、校验和损坏均拒绝。 |

## 本机实际演练

- 临时根目录 `/tmp/certlab-forge-integration-check`，API18000/网页15173/Forge14175，独立合成数据；三端健康均200。原业务8000/5173/4175及其数据未用于本轮修改或外发。
- 使用 App 原生 complete bundle 及 Forge 快照，在 `/tmp/certlab-forge-integration-restored` 恢复，三端再次健康200；反复 init 返回 initialized=false，原 OM 修订保持。
- 真实 CertLab 登录、机构/邮箱身份、当前用户 MCP 发现34项能力通过；真实报告 bootstrap 返回201，建立合成报告 Work。此步骤未执行外部模型，也没有保存专业判断。
- 演示账号缺邮箱曾使真实绑定失败；已修正为不可投递测试邮箱并测试保留原邮箱。修正只作用于演示数据命令，没有放松 Forge 身份规则。
- 演练结束通过启动器停止全部自有进程；status 显示 processes=[]。临时快照保留以供核对，生产实例未重启。

## OM 用户分支

通过 PersonalOmChanges 原有保存/校验/提交流程修改4个评估工作文档，删除通用 PDF 格式读取、原生工具、笔记和压缩操作说明，保留认证证据充分性、来源资格、专业判断、人工交接及回执规则。

用户 `usr_a37acaae621f71bdca7e1469` 分支由 `9cf469622c054353ab88aeb254884b9c6fed9d81` 更新为 `cc5b919569bc3e8d344ff208b009d6e57add917c`。组织 main 保持 `fdc66f90eff8e8d1f7456c25036be7d0ad5d9cb3`，没有自动合并或覆盖其他用户草稿。

## 最终回归

- Forge Domain：23通过；API：132通过。
- Forge Workbench：类型、格式、构建通过；单元15通过，Playwright19通过。
- CertLab：uv sync、ruff check/format、strict mypy通过；pytest1552通过、7跳过。
- App 联调/发布工具：2通过；两仓库 diff --check 通过。

## 发布验收边界

本机 Docker daemon 未运行，docker info 明确无法连接。没有执行 Forge 基础镜像构建、App 派生镜像构建或容器组合启动，也没有伪造镜像摘要。发布环境仍须固定已构建的基础镜像摘要，构建 App 镜像，执行同配置代表任务、组合兼容及停机恢复演练后再发布。源码模拟模型与本机健康检查不替代这些验收。

本轮没有向供应商模型发送新版客户说明书；已有真实资料验收见 [先前记录](pi-native-record.md)，仅证明其当时受验范围。新能力的专业质量与视觉理解仍须真实资料及专业人员复核。

## 变更后设计反思

现场可见路径覆盖本轮适配器、启动器、初始化、恢复、OM 治理与验证；最初探索部分经上下文整理保留为交接摘要，缺失部分不作独立路线结论。

| 检查 | 结果 | 证据与未来风险 | 置信度 / 级别 |
| --- | --- | --- | --- |
| Missing Path | found | App 协议仍写目录接受/WD allowlist，而实际 MCP 已没有该门槛；后续集成者可能照旧文档重复实现授权。已在本次授权的集成文档修改中纠正，并链接当前统一入口。 | high / how-level |
| Boundary Bypass | not-found | Pi 类型和安装保留适配器；生命周期在领域用例；App 备份/恢复复用已有命令；用户 OM 走原治理用例。未发现需绕过既有边界的现场证据。 | high / — |
| Unowned Capability | not-found | 基础阅读随 Forge、App 配置/装配在 CertLab、业务规则在 OM、恢复机械路径在 Forge 运维适配器，均沿已批准所有者放置。 | high / — |

后续维护从部署手册进入实际适配器与 App 命令；无需新建全局注册表或修改 Agent 自身治理规则。没有额外待决的架构所有权问题；不因本轮通过而推断生产隔离或专业正确性已验收。


## 2026-10-23 后续质量迭代

上述I-01记录为当时的实现；当前默认资源已改为working-notes并删除pdf-reading，Asset读取细节由App MCP说明。质量测试入口只读调用实际Pi适配器和临时App，不能代替生产Work/保存验收。最终API类型检查及133项全量回归通过。当前本地API/Forge已空闲备份重启，旧会话与OM保留；真实模型比较的完整记录在CertLab evaluations/semi-s2-manual-v2/results-20261023.md。
