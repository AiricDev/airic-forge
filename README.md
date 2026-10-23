# AiricForge

面向业务 App 的 Agent 执行、Operating Model 治理和实践学习服务。通过 App 所有的适配器对接业务系统，在 App 中提供 Copilot，并在工作台管理个人/组织 OM 与 Reflection。

- [文档导航](docs/README.md)
- [App 集成与交付](docs/app-integration.md)
- [当前技术设计](docs/tech-design.md)
- [开发与部署](docs/deployment.md)
- [开发计划](docs/development-plan.md)
- [App 集成 Skill](skills/airic-app-integration/SKILL.md)

要求 Node.js 24 与 pnpm。仓库维护入口：pnpm install --frozen-lockfile、pnpm build、pnpm check、pnpm test；前端另运行 Workbench format:check 和 pnpm test:e2e。实际启动参数、当前能力和验收边界见上述文档，运行数据不进代码版本库。
