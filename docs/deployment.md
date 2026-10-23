# 开发、装配与发布

Forge作为版本化第三方组件发布。App拥有适配器、业务MCP、Agent配置、依赖、种子、开发启动器和发布组合；组织OM在独立Git仓库运行时演化。业务适配器不能放进Forge源码或组织OM。

## 构建与本地反馈

要求Node24、pnpm和Git。安装锁定依赖后执行pnpm build/check/test。Domain和API的build.mjs先清空各自dist，再编译产品源码；测试单独编译到test-dist，避免已删除文件、测试夹具或验收入口进入产品。工作台产物在apps/workbench/public，由API同源提供。

App开发启动器应在本机增量构建Forge、启动独立App/Forge进程、管理自己的临时数据和端口；无需Docker build。Forge源码和App适配器变更后排空并重启对应实例。生产业务数据库不得作为测试数据库。App自己的资料解析、前端和Worker保持各自开发反馈机制。

## 显式配置

环境示例在apps/api/.env.example。FORGE_APP_ID、FORGE_APP_URL、FORGE_APP_ADAPTER_MODULE和FORGE_ORGANIZATION_ID由App部署提供。模块导出createAppPort工厂，见[适配器契约](contracts/app-adapter.md)。FORGE_PROJECT_DIR保存生效OM，FORGE_DATA_DIR保存运行数据，两者必须分离；默认路径是runtime/project和runtime/data，没有业务App默认目录。实例标记绑定App、组织和规范路径，不能拿另一App的数据启动。

Bootstrap显式传入appId/workType/entityId；默认使用workType同名WD，FORGE_WORK_DEFINITION可以绑定部署使用的WD。没有内置业务工作类型或自动导入种子。新组织显式执行：

```sh
node --env-file=/private/forge.env apps/api/dist/forge-ops.js prepare
node --env-file=/private/forge.env apps/api/dist/forge-ops.js init /absolute/app/operating-model-seed
node --env-file=/private/forge.env apps/api/dist/server.js
```

init是离线OM管理，不调用App或模型；重复初始化不覆盖既有OM。运行数据不随代码升级自动清理。旧业务轨迹保留，不伪造旧会话恢复，不迁移或重放未决外部命令。

## Pi原生配置

FORGE_AGENT_CONFIG_DIR指向App随代码管理的目录，含work/settings.json和reflection/settings.json。包、extensions、skills、prompts使用Pi原生配置；路径相对settings文件。npm固定版本，Git固定完整提交。在受控准备阶段执行prepare，再执行check验证资源与系统程序。FORGE_AGENT_CACHE_DIR保存可重建依赖，不能与OM混放；FORGE_REQUIRED_PROGRAMS默认git。

Work默认获得通用working-notes；App资料的定位、图文/区域及覆盖语义由App MCP指导。Reflection不继承Work包或App凭据。禁止隐式加载宿主个人目录资源。部署代码和扩展拥有进程能力，应由App团队审查；工作目录不承诺OS沙箱。

资源和锁文件摘要、部署身份与会话关联进入审计。模型、OM、工具快照或资源变化切换会话，旧记录和笔记保留，不猜最近会话。FORGE_DEPLOYMENT_ID应使用App装配镜像/发布组合摘要；本地未指定时计算Forge代码身份，App启动器必须在适配器变化后重启并记录对应代码版本。

## 镜像发布

Forge Dockerfile只发布通用组件、工作台和基础依赖；App派生镜像复制自己的适配器、Pi配置和OM种子，再执行prepare/check。根Compose需要App装配镜像及模块路径，不提供默认业务App。发布组合固定App/Forge/Pi/依赖/MCP协议版本，不通过运行时OM安装代码包。镜像验证在本地联调通过后单独执行，源码验证不等于容器验收。

## 停机、备份和恢复

先排空并停止App/Forge组合，保留未知命令原回执。SIGTERM/SIGINT拒绝新执行、取消并等待收尾，再关闭数据库；运维入口拒绝活动服务锁。使用App原生工具生成complete bundle，再运行：

```sh
node --env-file=/private/forge.env apps/api/dist/forge-ops.js backup /new/snapshot /complete/app-bundle --offline
node apps/api/dist/forge-ops.js verify /snapshot
node --env-file=/private/target.env apps/api/dist/forge-ops.js restore /snapshot
```

快照包含OM、工作树/未完成草稿、数据库、轨迹、Pi会话和工作文件及App bundle，排除可重建缓存。检查文件校验和与数据库完整性。恢复要求相同App/组织/部署身份，目标project/data全新且分离；App数据仍由App原生工具恢复，不重做业务效果。快照格式变化明确拒绝旧格式，不通过猜测补字段。旧快照保留，用原版本恢复后按明确升级流程处理。

跨路径恢复修复Git worktree和Pi显式会话路径，保留ID、正文与历史回执；未知外部路径拒绝，失败保留新目录供诊断。Secret、镜像和部署配置另行保管。
