# 阶段 5 验收记录

状态：本机 P0 阶段 5 交付验收完成；正式生产部署另行配置。执行日期：2026-10-02 至 2026-10-03。环境：本机 Forge Docker、独立 CertReporter 测试 SQLite、真实 Report / Report Type 浏览器页面，以及隔离恢复端口。

## 已验证

- **联合数据快照：**新增 `scripts/state_archive.py`，只接受 Forge `/project`、Forge `/data` 和 CertReporter `/data` 三个根，检查 Git、Turn 引用的提交、两份 SQLite 及关键记录数，生成三份归档、SHA-256 清单；恢复前校验归档，拒绝覆盖非空目标。`scripts/backup-p0.sh` 对同机 Compose 同时停止两服务，生成恢复点后自动重启。隔离测试验证旧/新 OM 修订、未完成 Proposal worktree、JSONL、Reflection、App 回执和媒体文件在同一路径恢复；损坏归档与覆盖请求被拒绝。
- **真实测试数据恢复：**从现有 Forge 测试容器的 `/project` 与 `/data` 和 CertReporter 测试 SQLite 生成联合快照，还原到隔离目录。恢复后的 Forge 容器在独立端口健康且可登录，浏览器读取到用户 active HEAD `3ce608386fd9a9202de9d7b5688d42df0642c87c`、同一 Work 的四个 Turn 及其旧/新 OM 版本。恢复后的 CertReporter 在另一独立端口按原 `cmd_025964b5a25dd2e86604dffc` 查询到 `committed` 回执；未重放命令。恢复目录包含三次 Reflection 与三条 Proposal 记录。原运行服务未被还原数据覆盖，临时验证容器与 Django 进程已关闭。
- **凭据隔离：**用测试 App bearer token 扫描恢复后的 Forge `/project` 与 `/data` 文件，匹配数为 0。模型配置保存在单独的 Git 忽略 `.env`，不属于三份数据归档；恢复文档要求另行保管持久的 Django secret。
- **同机部署与真实命令：**`deploy/p0/compose.yml` 将 Forge 与 CertReporter 分成两个服务，绑定三个持久化目录。Forge 自身 Compose 不再从 `AIRIC_*` 读取模型配置，增加健康检查并只绑定本机端口。现有测试模型配置已迁入 Git 忽略且权限为 0600 的 Forge 本地 `.env`；重建后容器为 healthy，`FORGE_MODEL_*` 存在而旧 `AIRIC_API_KEY` 不在环境中。从空 Forge 目录及隔离 CertReporter Report 夹具启动同机双容器，浏览器完成首次账户关联、能力目录接受、只读 Turn 和 `report.update-master`；Report 页面从修订 5 刷新到 6，`project_name` 为 `Stage 5 P0 verified`。CertReporter 前端补齐 `/airic/v1` 代理供 Forge 获取权威上下文。两个服务健康检查均通过。
- **同机联合恢复：**对上述双容器执行 `scripts/backup-p0.sh`，脚本停止两服务、生成三份数据的同一恢复点并自动重启。将快照还原到另一组目录和端口后，恢复的 CertReporter 与 Forge 均为 healthy；浏览器在 Report 页面看到修订 6 和已保存的字段，从 Forge 恢复原 Work 的两轮对话。恢复的 CertReporter 按原 `cmd_8c40534216e946df58fd81b4` 经 HTTP 返回 `committed`，与 Forge JSONL 轨迹匹配，没有重放命令。恢复实例旧 sidecar 端口 4174 不可用，两服务健康仍通过。
- **既有 P0 场景：**P0-01～13、15～19、21 的身份、App 命令、轨迹、个人 OM、Reflection 和浏览器闭环证据分别见阶段 1～4 记录；P0-20 的三份数据联合恢复在本阶段得到真实数据演练。P0-14 在 PRD 中不存在。
- **Report Type 迁移与侧车退出：**CertReporter 的 Report Type Drawer 现经 Forge bootstrap 与 ACP WebSocket 运行 `report-type-definition` Work，Forge OM 新增独立 WD package，Turn 只注册已接受目录中获准的 `report-type.*` 能力。CertReporter 源码、镜像构建、进程启动、健康检查、前端代理及部署文件中的旧 sidecar 路径已移除。保留的 `/airic/v1` 业务 API 仍由 CertReporter 持有。隔离同机实例中，浏览器完成能力接受、只读 Turn、TXT 附件随下一 Turn 传入、`report-type.update-draft` 保存（`cmd_9a1a693aa4aa00a96c4707a0`）；名称变为 `Forge P0 Report Type Demo`，状态保持 draft。Forge 重启后重新 bootstrap，原 Work 的两轮历史可读，第三轮从权威上下文读到新名称；CertReporter 持久回执仍为 `committed`。演示实例为 CertReporter `127.0.0.1:3003`、Forge `127.0.0.1:4179`，两容器 healthy。
- **可读附件：**Forge 接受 PDF/DOCX/TXT，分别用 `pdftotext`、`pandoc`、UTF-8 解码提取；8 MiB 文件上限、每票据最多 3 件、每件最多 100000 字符，提取失败或空内容拒绝。三种格式的合成夹具均在生产镜像内成功提取。附件仅供选定的下一 Turn 使用；Forge 的 SQLite/JSONL 轨迹记录名称、摘要与提取长度，不写入附件原文。pi-sdk Turn 改用进程内会话，避免其会话文件保存原文；隔离实例在重启与后续 Turn 后扫描 Forge 活跃持久目录，未找到测试附件的原句。
- **回归门槛：**Forge API 18/18、领域 8/8，CertReporter 业务协议 7/7 通过；两份生产镜像完成构建。CertReporter 全仓前端 TypeScript 检查仍有既存 MUI 等错误，本次改动的 Report Type Drawer 未在错误列表中。
- **现有实例的 Report Type Turn 与恢复：**在 `127.0.0.1:3001/4177` 的已迁移实例中，浏览器从已发布 Report Type 正常创建 v1.1 草稿，通过 Forge Drawer 完成只读 Turn。停机检查 SQLite 证实 Work `wrk_f47da62c8df9a265c5344a00`、原 Session 和 Turn `trn_44d06c9fee5a63851575168f` 已持久化，Turn 的 OM 为迁移提交 `5a19a3d1c8025accfd3303047a5d179fac1f8af0`。重启后重新 bootstrap，浏览器展开同一 Work 的历史回复。创建后续草稿改用应用内对话框；Turn 期间 draft 保持 draft 标识，写按钮禁用。
- **迁移后联合恢复：**对含上述 Type Work 的现有双服务执行 `scripts/backup-p0.sh`，得到 `/private/tmp/airicforge-stage5-post-report-type-20261003` 并自动重启。快照校验通过，还原至 `/private/tmp/airicforge-stage5-restore-report-type-20261003/state` 后，Type Work 与 Turn、完成状态和 OM 提交均一致。最终回归再次通过 Forge API 18/18、领域 8/8、CertReporter 协议 7/7，CertReporter 生产镜像构建通过。
- **验收中的存储干扰与修复：**首次 Type Turn 后，在 Forge 仍运行时直接从 macOS 宿主机打开 bind-mounted SQLite 做只读检查，导致容器持有已删除的 WAL/SHM；该测试 Turn 的 JSONL 有内容而 SQLite 索引未持久化。保留孤立轨迹于 `/private/tmp/airicforge-stage5-orphan-trajectory-20261003`，原有数据库完整性检查通过。随后停止服务后检查 SQLite，重新执行 Type Turn，并通过停机、重启、浏览器历史恢复及联合备份还原验证。部署说明明确禁止在运行中从宿主机直接检查该 SQLite 文件。

## 现有数据迁移与上线边界

- **既有 Forge OM 升级：**经用户明确授权，在现有 `127.0.0.1:3001/4177` 实例上执行了 `scripts/migrate-report-type-om.mjs`。先用 `scripts/backup-p0.sh` 制作并验证三目录联合备份 `/private/tmp/airicforge-stage5-pre-om-migration-20261003-current`，确认两个 OM worktree 干净，停止 Forge 后迁移并重启。组织 `main` 和现有用户 `users/usr_e8fa68c2e662c1687c1aa419` 的 HEAD 均为 `5a19a3d1c8025accfd3303047a5d179fac1f8af0`，提交含 `Migration-Source: AiricForge Stage 5`；两个分支都可读取 `report-type-definition/work.yml`，Git fsck 通过，两服务 healthy。既有已接受目录包含五项 `report-type.*` 能力。此次是一次性 P0 数据迁移，不依赖 P1 的组织贡献选择性合并或个人同步流程。
- **正式上线前配置：**同机示例的 `.env.example` 仅供填写；实际部署时仍需固定兼容的镜像、配置域名/TLS 和持久的 Django secret。本机测试数据与恢复演练不代表生产迁移已完成；这些属于目标环境的发布工作，不影响本机 P0 阶段 5 交付验收结论。
