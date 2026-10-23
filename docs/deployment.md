# 开发、能力配置与交付

Forge 是 App 装配的版本化组件。App 管理代码、Pi 配置、依赖和发布；组织 OM 在独立 Git 仓库演化。通用阅读方法随 Forge 能力发布，不放进组织 OM。CertLab 的完整本机入口见其 `docs/forge-integration.md`。

## 本机反馈回路

要求 Node.js 24、pnpm、Git，以及 App 自身依赖。在 CertLab 根目录运行：

```sh
node tools/forge-dev.mjs prepare
node tools/forge-dev.mjs init --demo
node tools/forge-dev.mjs start
node tools/forge-dev.mjs status
node tools/forge-dev.mjs restart
node tools/forge-dev.mjs stop
```

首次 prepare 安装依赖并准备原生包；普通 Turn 不安装包，服务运行时拒绝依赖准备。init 只为新组织导入 App 的固定 seed，重复执行不覆盖现有组织或个人 OM。start/restart 增量构建 domain/API，随后启动两端服务与 App 网页，不需要 Docker。App/API 和网页使用各自源码热更新；Forge 代码修改后显式 restart，Skill/配置修改在下一次执行时重新解析并固定内容快照。

默认开发数据位于 CertLab 的 `data/forge-dev`，端口为 API 18000、网页 15173、Forge 14175。可用 `CERTLAB_DEV_ROOT`、`CERTLAB_DEV_*_PORT`、`CERTLAB_FORGE_ROOT` 改写。启动器只停止登记且进程身份仍匹配的子进程组；遇到占用端口直接拒绝，不处理其他实例。开发目录用于数据组织，不承诺 OS 隔离。

模型和供应商配置保持现有 `FORGE_MODEL_*` 环境变量，通过进程环境或 `node --env-file=/private/path ...` 注入，不提交到配置目录。Django secret 单独生成并保存在开发目录，恢复时单独提供原 secret。不要向正在运行的业务目录执行开发 init。

## Pi 原生配置和依赖

`FORGE_AGENT_CONFIG_DIR` 指向 App 随代码管理的目录，必须含 `work/settings.json` 和 `reflection/settings.json`。采用 Pi 原生设置及包格式，例如：

```json
{
  "packages": ["../packages/document-tools"],
  "skills": ["../skills/company-tools"],
  "extensions": ["../extensions/source-helper.ts"]
}
```

路径相对各自 settings 文件。包使用原生 package.json `pi` 字段声明资源；npm 必须是明确版本，git 必须为完整的40位提交。新增依赖后在受控准备阶段执行 `node apps/api/dist/forge-ops.js prepare`；之后执行 `check` 检查两类配置、资源导入及系统程序。`FORGE_AGENT_CACHE_DIR` 管理可重建依赖缓存，默认在 data/agent-packages；不要和生效 OM 混放。`FORGE_REQUIRED_PROGRAMS` 声明需要的系统命令，默认 git。

Work 和 Reflection 只加载各自显式选择的资源。Work 默认获得通用 pdf-reading Skill；Reflection 不继承 Work 包或 App 凭据。禁用宿主个人目录和工作目录中资源的隐式发现。扩展代码拥有进程能力，必须由 App 团队审查。

资源解析使用 Pi 原生包管理和加载器；Forge 记录配置、资源与安装锁文件的摘要，复制本轮源码/Skill 快照，并把摘要、部署身份写入原生会话关联及审计。相关代码、模型、OM、工具快照或资源变化会切换会话，旧记录和工作笔记继续保留；不会猜“最近会话”。准备后的依赖目录在服务运行时不得更新，发布通过新镜像替换。

管理员可访问 `GET /api/v1/agent-environment` 获取部署身份及 Work/Reflection 资源摘要；匿名401、非管理员403，配置不可用503，不返回密钥。`FORGE_DEPLOYMENT_ID` 使用发布镜像摘要；本机未指定时计算代码身份。

## 初始化和容器装配

Forge Dockerfile 发布 API、工作台和通用能力，包含 Git/Poppler；不捆绑 CertLab 业务种子。仓库 seed/certlab 是本地测试夹具。App 镜像基于固定 Forge 镜像，复制自己的 agent 配置及 operating-model-seed，在构建时 prepare/check。CertLab 的构建入口 `tools/forge-release.mjs` 要求基础镜像 `@sha256`，不自动推送。

正常启动只创建空 OM，显式新组织初始化为：

```sh
node apps/api/dist/forge-ops.js init /absolute/app-owned-seed
```

导入在临时目录验证完整 OM 后落地，记录 seed 内容摘要和提交；重复执行返回原状态。组织和个人 OM 后续只走已有治理流程。两个持久化目录 project/data 必须属于同一 App/组织。Secret 单独注入，短期 App token 不落盘。

CertLab 的 `deploy/forge.compose.yaml` 与现有 App Compose 组合；部署必须使用经验证镜像摘要，并记录 App、Forge、Pi、能力和 MCP certlab/v1 的版本组合。镜像示例不是通用 App 注册服务，当前业务适配器仍为 CertLab。

## 停机备份与迁移

先排空并停止整个 App/Forge 组合，保留未知命令原回执，不自动重放。Forge 进程在 SIGTERM/SIGINT 时拒绝新执行、取消并等待 Work/Reflection 收尾，再关闭数据库。运维入口拒绝活跃服务锁。跨进程强制终止不能保证业务命令未提交。

使用 App 原生备份生成 complete bundle，再执行：

```sh
node apps/api/dist/forge-ops.js backup /new/snapshot /complete/app-bundle --offline
node apps/api/dist/forge-ops.js verify /snapshot
node apps/api/dist/forge-ops.js restore /snapshot
```

CertLab 启动器提供统一 backup/restore 包装。快照包含 OM、工作树/未完成草稿、数据库、轨迹、Pi 会话、工作文件和 App bundle，排除可重建 Agent 缓存；文件校验和与数据库完整性均检查。恢复要求相同组织、相同部署身份、全新且分离的 project/data 路径。先恢复原版本并验证，再按明确升级步骤迁移；不支持把新数据库直接交给旧软件。

恢复修复 Git worktree 双向路径、Pi 显式会话绑定和 JSONL 会话头路径，保留会话 ID 和正文/历史业务回执，输出修复记录；未知外部路径拒绝。App 数据使用其原生恢复工具，不自动迁移或重做业务效果。中途失败保留新目录供诊断，不覆盖现有实例。Secret、镜像和配置由发布方另行保管。操作员必须确认旧版无服务锁的服务也已停机。

验证记录见 [本轮集成验收](acceptance/app-integration-record.md)，持久化边界见 [恢复契约](contracts/persistence-and-recovery.md)。
