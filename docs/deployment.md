# 当前开发与部署入口

本文件描述当前可用入口。完整的 App 所有联调启动器、显式 Pi 配置和可重复发布装配仍按 [集成需求](app-integration.md)实施。

## 本机开发

要求 Node.js 24、pnpm 及 Git。临时 PDF 文字附件的提取使用 Poppler pdftotext；正式资料的文字、图像和区域读取通过 CertLab MCP。

在仓库根目录准备 pnpm install --frozen-lockfile 并执行 pnpm build。导入的 domain 包使用构建产物，修改后需要增量构建。API 开发入口 pnpm dev 使用 tsx watch；Workbench 开发入口 pnpm --filter @airic-forge/workbench dev 使用 Vite。它们无需 Docker build，但不是一条已完成的 CertLab/Forge 统一启动器。

向进程显式注入当前配置。API 不自动读取任意目录的 .env；apps/api/.env.example 是字段示例，不含 Secret。路径应使用绝对路径，避免 pnpm 切换工作目录后使用另一套数据：

- FORGE_PROJECT_DIR、FORGE_DATA_DIR：独立且已有正确实例绑定的 OM/运行目录，开发不要指向业务实例。
- FORGE_CERTLAB_URL、FORGE_ORGANIZATION_ID：当前 App origin 和组织；Forge 从 /mcp 发现工具。
- FORGE_ALLOWED_ORIGIN、FORGE_PUBLIC_URL：浏览器 Origin 与可访问 Forge 地址。
- FORGE_WEB_DIST_DIR：工作台产物的绝对路径。
- FORGE_MODEL_PROVIDER、FORGE_MODEL_ID、FORGE_MODEL_BASE_URL、FORGE_MODEL_API_KEY：实际模型配置；密钥单独注入。

先启动本地 CertLab API/MCP，再连接 Forge 和前端。检查 /health、工作台深链接、实际身份、MCP 工具和代表任务的回执。资源重载及统一生命周期诊断尚待实现。

## Docker

根 docker-compose.yml 是当前单 Forge 服务的本地构建示例，修正为 FORGE_CERTLAB_URL 并要求组织 ID。App API/MCP 需另行运行；示例默认使用 Docker Desktop 的 host.docker.internal，其他环境应显式覆盖可访问地址。

Dockerfile 构建 domain、API 和 Workbench，安装 Git 与 Poppler，不包含旧 Office 转换或 OM 迁移程序。两个持久化卷分别挂到 /project 和 /data。正常服务启动创建空 OM，不自动从 seed 导入示例；实际专业 OM 需通过维护/治理准备。

示例尚未提供固定发布镜像摘要、App 自选 Pi 依赖装配或协调备份恢复，不应被称为完整正式交付方案。生产由 App 团队固定组件版本、构建能力和系统依赖，按 [集成需求](app-integration.md)完成发布与恢复验收。

## 检查与数据保护

代码变更运行 pnpm build、pnpm check、pnpm test；前端变更还执行 Workbench format:check 与 pnpm test:e2e。测试仅使用一次性数据和模拟模型，不启动真实客户资料评估。

修改实例配置、升级或停止服务前，先处理在途任务与未知业务结果。数据备份范围见 [恢复契约](contracts/persistence-and-recovery.md)。仓库清理不删除 runtime 内容或 Git 历史，也不自动重启实例。
