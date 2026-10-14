# Pi 1.x 升级与新能力评估

核对日期：2026-10-14。原依赖为 `0.99.2`；Pi 1.0 发布于 10 月 1 日，当前 npm 稳定版为 `1.2.0`（10 月 12 日）。本次将 `pi-ai`、`pi-coding-agent` 同步升级并精确锁定为 `1.2.0`，保持现有 Work/Reflection adapter 与领域契约。

## 上游变化与 Forge 的使用价值

| 能力 | 上游变化 | Forge 判断 |
| --- | --- | --- |
| Codemode | 0.99 已提供；1.0 缩短提示并改进报错，1.2 补充输入约束描述 | 可试验批量只读轨迹/资料检索；中间结果留在脚本中，只返回筛选结果。上游约 40% 提示缩减来自其默认工具示例，不能当作 Forge 的性能结果 |
| MCP / deferred tools | 0.99 已提供；1.x 改进 OAuth、重连和结构化返回兼容性 | 工具数量增加后可按需发现，但搜索范围必须来自已接受目录与 WD 白名单；业务命令仍走 App 授权、幂等与回执 |
| Virtual Models / classifier | 0.99 已提供实验性路由；1.1 增加图像分类支持 | 可试验检索、分析的模型分流；先定义本轮允许的模型策略与实际模型归因，不能由 classifier 决定授权或业务结论 |
| 耗时与上下文处理 | 1.1 增加模型响应与工具耗时，1.2 压缩摘要排除 thinking blocks | 适合后续容量与诊断指标。升级不会自动将 SDK 指标写入 Forge 产品轨迹 |
| Provider 修复 | 1.x 改进繁忙错误重试、Anthropic 工具兼容、OpenRouter 按 Key 目录等 | 现有 harness 获得底层修复；动态目录仍需显式刷新，当前 `refreshOnCreate: false` 不会自动获取按 Key 的目录 |
| TUI / 登录 | 1.0 默认全屏，增加远程 Anthropic 登录等 | Forge 使用 SDK 和服务端 API Key，这些 CLI 交互变化不是产品新能力 |

当前 SDK 使用 `noExtensions: true`、`noTools: "builtin"` 和显式 `customTools`。CLI 的 MCP/Codemode 扩展不会因为升级自动进入 Forge 会话。

## Pi Durable 的适配边界

Pi Durable 是独立的实验性 harness，API 可能在版本之间无预告变更。它将输入、模型响应、工具意图和任务 checkpoint 先提交后展示，可恢复运行中的任务，支持会话 fork、持久 inbox、子任务、背景压缩以及 Memory/SQLite/JSONL 存储。

建议首先在只读 Reflection 分析中试验跨进程恢复，再评估候选文件写入。接入前必须满足：

- **恢复语义：**工具只有声明 `replay: "safe"` 才会在中断后重跑，否则模型收到 `interrupted`。业务命令不能因此被直接声明可重放；先沿用 Forge 的 `unknown → 查询原命令回执`，保持原 commandId/idempotency key。
- **版本与权限：**持久任务绑定 Forge Turn 的 OM 修订、目录版本和资源范围；恢复时重新获取有效身份授权。Durable registry 的热更新和子会话配置不能绕过本轮固定版本或扩大权限。
- **数据保存：**Work 的附件正文目前只在内存 Pi 会话中使用。Durable 默认保存会话内容，直接替换会改变这一约定；Token、附件正文与模型私有推理必须在存储入口处理。
- **事实归属：**Durable transcript/checkpoint 是执行内部状态；Forge trajectory 仍是产品证据，App 回执仍是业务事实。需要跨存储关联与去重，不能把模型完成视为业务提交成功。
- **运行部署：**一个 storage 由一个进程拥有，上游没有跨进程锁；SQLite 的 WAL/NORMAL 保证进程崩溃恢复，但不承诺断电后最新提交仍在。必须与 Forge 的单实例部署和备份约定一致。

以上是基于上游契约与当前源码的适配分析，本次未安装或迁移到 Pi Durable，也未启用新的扩展。

## 验证

升级前后：`pnpm build`、`pnpm check`、`pnpm test` 全部通过（domain 9、API 25，共 34 项）。`pnpm install --frozen-lockfile --ignore-scripts` 通过；锁文件只更新 Pi 及其相关依赖，保留原前端包版本。

`node scripts/acceptance/pi-sdk-smoke.mjs` 通过。该脚本直接运行安装后的 Pi SDK 与 Forge 的两个真实 adapter，向临时本地 SSE 模型服务发送 5 次请求，验证工具白名单、按需文档调用及结果反馈、Work 流式返回、Work 无会话 JSONL/附件正文落盘、Reflection 轨迹工具以及重新创建 runner 后的持久会话恢复。测试使用临时数据目录并自动清理，无 App 调用或真实模型 Key。

本次没有运行真实模型服务、生产部署或 Pi Durable 的崩溃恢复实验；新功能的效率与业务成效仍待单独测量。

## 一手资料

- [Pi Coding Agent 1.0 changelog](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/CHANGELOG.md)
- [Pi Coding Agent 1.2 changelog](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/CHANGELOG.md)
- [Pi AI 1.2 changelog](https://github.com/earendil-works/pi/blob/v1.2.0/packages/ai/CHANGELOG.md)
- [SDK 扩展加载与会话契约](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/sdk.md)
- [Pi Durable 1.0 README 与恢复/存储约定](https://github.com/earendil-works/pi/blob/v1.0.0/packages/durable/README.md)
