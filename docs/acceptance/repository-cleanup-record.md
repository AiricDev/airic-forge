# 当前仓库清理与回归

日期：2026-10-23。范围为受版本控制的 Forge 代码、文档、样例和测试入口；不删除运行数据、不重写 OM/Git 历史、不重启服务。本轮不实现下一步的通用 Pi 配置或 App 联调启动器。

## 清理结果

删除 37 个废弃文件，将 8 个仍有价值的测试/辅助文件改为当前语义名称；不保留旧入口包装、重定向或归档副本。

- 删除旧 CertReporter 部署配方、种子及 App 领域讨论稿，删除失效 ADR、迁移基线和已替代的自定义压缩/结构化阅读笔记记录。
- 删除旧数据库 OM 草稿/Proposal/贡献迁移链、启动迁移预检、旧 Git Proposal 方法、迁移专用测试和旧统计项；草稿写入统一走 PersonalOmChanges，内容与贡献继续只由 Git 管理。
- 新数据库直接创建当前结构，不再创建旧表或运行结构转换、账号自动提升。已有当前格式的用户/Work/轨迹和审计保留；打开数据库不补授管理员权限。
- 删除无人调用的资料检索提示、检索探针、旧阶段脚本、容量演示和备份工具。当前发布级协调备份/路径迁移仍是待实现需求，文档不再指向已删除的脚本。
- 删除已退出的 Report Type 工作类型和前端 StageOne 包装；生产直接加载 WorkspaceApp。旧测试改用真实的个人草稿、组织选择与合并流程，保留冲突、并发、权限与来源测试。
- 删除 Word 附件转换和 pandoc 依赖，当前临时附件仅 PDF/TXT；正式资料的可读性通过 App MCP 提供。API 资料契约中的表格用 XLSX 示例验证。
- 修正单服务 Compose 的 CertLab/组织配置，删除容器中的旧迁移 COPY。Compose 配置校验通过，不代表已构建或完成新版发布方案。
- PRD、技术设计、OM、开发计划、资源权限与恢复契约改为当前内容。保留 App 集成需求及 16 个待实施行为场景，明确已有能力与缺口。

CertLab 的 Playwright 仍使用 certlab-browser-fixture，tools/verify_airic_b1.py 仍调用协议、资料和 PDF 探针；这些是维护中的跨仓库回归入口，未因名称较旧而删除。真实模型验收继续由 pi-native-live-probe 显式执行，不在本轮重新外发资料。

## 数据与暂存边界

runtime 下的 OM、数据库、会话、笔记、备份和轨迹未操作。已退出部署目录里未跟踪的本地数据与 Secret 也保留；Git 忽略规则和 Docker 构建排除继续保护它们，不把数据清理混入代码清理。

已有暂存区不重置、不覆盖、不代为提交；本轮删除和修改体现在工作区。用户应将最终工作区内容一并审阅，而非只查看此前暂存快照。

代码不支持未升级的旧产品 schema，亦不会 DROP 现存历史表。需要切换实际实例时，先备份并检查格式，按当前部署/恢复契约另行执行。

## 验证结果

- Domain：23 通过。
- API：125 通过，无失败或跳过。使用真实 Git/SQLite、临时 MCP/ACP 与本地模拟模型。
- Workbench：15 通过；生产构建、类型与 Prettier 格式检查通过。
- Playwright：19 通过；使用一次性真实 API、SQLite/Git 与确定性模型，不访问业务数据库。
- Domain/API 构建及类型检查通过。对删除源文件遗留的生成模块已清理，测试没有继续执行旧 dist 测试。
- Compose：使用合成组织 ID 执行 config --quiet 通过。未构建 Docker 镜像、未重启当前实例。
- 文档/Skill 的本地链接、Skill 格式及 git diff --check 校验通过。

测试日志位于本机临时目录：forge-cleanup-domain-final.log、forge-cleanup-api-final.log、forge-cleanup-workbench.log、forge-cleanup-workbench-build.log、forge-cleanup-e2e-final.log。测试数量下降来自已删除的旧行为和迁移测试；当前并发、冲突和专业授权约束仍有覆盖。

浏览器首次回归发现移除旧工作类型后，两个知识草稿共享同一 WD 导致冲突。夹具已将无冲突的旧草稿合并场景改为独立的交接方法修改；有冲突的三方合并仍由 Domain/API 场景验证，没有降低校验或放开提交。

## 设计复查

本轮发现、引用核对、删除与回归过程在当前任务中完整可见。路由由文档入口、runtime/use-cases/ports 及其 adapter/test 组成；没有创建新的能力所有者或改写业务授权。

| 检查 | 结果 | 证据与未来风险 | 置信度 / 层级 |
| --- | --- | --- | --- |
| Missing Path | found，已补接入指引 | 本仓库看似无调用方的探针实际由 CertLab tools/Playwright 使用；现已在 CertLab 接入指南明确入口。只做单仓库引用搜索会误删跨仓库测试。 | high / how-level |
| Boundary Bypass | not-found | 删除数据库 OM 写入与旧 Proposal 夹具后，通过现有个人草稿/组织治理用例完成效果；App 授权、原回执和未知结果保护不变。 | high / — |
| Unowned Capability | not-found | 清理后的运行、Git 治理与业务桥均在既有适配器/用例内；下一步通用能力与部署装配仍按已确认集成需求实现。 | medium / — |

后续测试维护应减少对同一浏览器夹具执行顺序的依赖。当前 suite 明确按单 worker 运行；本次未引入新的测试框架、共享策略或权限规则。
