# 阶段 5 验收记录

状态：进行中，尚未关闭 P0。执行日期：2026-10-02。环境：本机 Forge Docker、独立 CertReporter 测试 SQLite、真实 Report 浏览器页面，以及隔离恢复端口。

## 已验证

- **联合数据快照：**新增 `scripts/state_archive.py`，只接受 Forge `/project`、Forge `/data` 和 CertReporter `/data` 三个根，检查 Git、Turn 引用的提交、两份 SQLite 及关键记录数，生成三份归档、SHA-256 清单；恢复前校验归档，拒绝覆盖非空目标。`scripts/backup-p0.sh` 对同机 Compose 同时停止两服务，生成恢复点后自动重启。隔离测试验证旧/新 OM 修订、未完成 Proposal worktree、JSONL、Reflection、App 回执和媒体文件在同一路径恢复；损坏归档与覆盖请求被拒绝。
- **真实测试数据恢复：**从现有 Forge 测试容器的 `/project` 与 `/data` 和 CertReporter 测试 SQLite 生成联合快照，还原到隔离目录。恢复后的 Forge 容器在独立端口健康且可登录，浏览器读取到用户 active HEAD `3ce608386fd9a9202de9d7b5688d42df0642c87c`、同一 Work 的四个 Turn 及其旧/新 OM 版本。恢复后的 CertReporter 在另一独立端口按原 `cmd_025964b5a25dd2e86604dffc` 查询到 `committed` 回执；未重放命令。恢复目录包含三次 Reflection 与三条 Proposal 记录。原运行服务未被还原数据覆盖，临时验证容器与 Django 进程已关闭。
- **凭据隔离：**用测试 App bearer token 扫描恢复后的 Forge `/project` 与 `/data` 文件，匹配数为 0。模型配置保存在单独的 Git 忽略 `.env`，不属于三份数据归档；恢复文档要求另行保管持久的 Django secret。
- **同机部署与真实命令：**`deploy/p0/compose.yml` 将 Forge 与 CertReporter 分成两个服务，绑定三个持久化目录；P0 Report 路径显式禁用旧 sidecar。Forge 自身 Compose 不再从 `AIRIC_*` 读取模型配置，增加健康检查并只绑定本机端口。现有测试模型配置已迁入 Git 忽略且权限为 0600 的 Forge 本地 `.env`；重建后容器为 healthy，`FORGE_MODEL_*` 存在而旧 `AIRIC_API_KEY` 不在环境中。从空 Forge 目录及隔离 CertReporter Report 夹具启动同机双容器，浏览器完成首次账户关联、能力目录接受、只读 Turn 和 `report.update-master`；Report 页面从修订 5 刷新到 6，`project_name` 为 `Stage 5 P0 verified`。CertReporter 前端原先未代理 `/airic/v1`，导致同机 Forge 获取 `report.context` 为 404；已在 CertReporter 的 `frontend/server.mjs` 补齐代理路由并重建镜像。两个服务健康检查均通过。
- **同机联合恢复：**对上述双容器执行 `scripts/backup-p0.sh`，脚本停止两服务、生成三份数据的同一恢复点并自动重启。将快照还原到另一组目录和端口后，恢复的 CertReporter 与 Forge 均为 healthy；浏览器在 Report 页面看到修订 6 和已保存的字段，从 Forge 恢复原 Work 的两轮对话。恢复的 CertReporter 按原 `cmd_8c40534216e946df58fd81b4` 经 HTTP 返回 `committed`，与 Forge JSONL 轨迹匹配，没有重放命令。恢复实例旧 sidecar 端口 4174 不可用，两服务健康仍通过。
- **既有 P0 场景：**P0-01～13、15～19、21 的身份、App 命令、轨迹、个人 OM、Reflection 和浏览器闭环证据分别见阶段 1～4 记录；P0-20 的三份数据联合恢复在本阶段得到真实数据演练。P0-14 在 PRD 中不存在。

## 尚未通过的交付门槛

- **旧 sidecar 与 Report Type：**Report Drawer 已使用 Forge；CertReporter 现有 Report Type 助手仍调用旧 sidecar。P0 示例显式关闭 sidecar，Report Type 功能需要单独确定保留或迁移方式。CertReporter 既有部署文件仍包含可选 sidecar 启动、健康检查与密钥配置，不能称为全局退出完成。
- **报告附件：**此前报告助手支持 PDF/DOCX/TXT 可读文本附件；当前 Forge Drawer 仅发送文本。阶段 2 已记录该差异，尚未完成迁移或得到明确的 P0 范围调整。
- **发布前配置：**同机示例的 `.env.example` 仅供填写；需使用兼容且固定的 CertReporter 镜像、实际域名/TLS 配置和持久的 Django secret。此处的本机测试数据不能作为生产迁移验收。
