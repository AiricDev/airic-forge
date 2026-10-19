# 完整 MUI 工作台恢复验收

日期：2026-10-19（Asia/Shanghai）。恢复对象为 CertLab 接入的 AiricForge 工作台，实际入口 `http://127.0.0.1:4175/`。

## 恢复内容

从本地 Git 早期提交 `4cb44fd` 取回完整生产 MUI 源码，放到 `apps/workbench`，不再依赖外部 `prototype/`。恢复登录/初始密码、工作台、Work 列表和轨迹、连续 Reflection、Proposal 审阅采纳、个人/组织 OM、贡献、治理、能力目录、用户、设置、Lens 和成效基线页面。移除不再使用的原型数据类型和快照编辑辅助函数；生产页面只调用现有 API。

参考用户给出的 [Magic Patterns v3 原型](https://www.magicpatterns.com/c/2gwm8vchu5rgynuxwhkg3t/preview)，Reflection 使用桌面对话/Proposal 并排、窄屏纵向排列；MUI 默认组件、主题和图标承载交互。assistant-ui 显示用户/Agent 消息，状态位于最新回复附近，不提供无用复制按钮。

当前 Reflection 运行 API 已存在，因此接入的是 `/runs`、`/runs/current`、`/events`、`/cancel`，没有恢复旧的同步等待交互。快照按 sequence 替换而非累加；断线和刷新恢复原运行；丢失提交响应先核对，显式重试复用原 requestId。已接受问题留在持久化历史，未完成的回复明确标识。权限失效停止自动连接。Proposal 生成期间可观察候选，治理写操作等待运行结束。

管理员可以读取他人的 Work、Reflection 和差异；原作者才可发起/继续/停止 Reflection、采纳个人 Proposal。校验和采纳继续由既有后端决定，UI 不接触数据库或 active OM 文件。业务库、真实 Work/轨迹和实际 OM active 均未通过验收操作修改。

历史逐分片 Work 轨迹在展示层合并。完成 Turn 使用最终回复；未完成 Turn 显示一个部分回复；引用历史片段仍可读到原事件。JSONL 不改写。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| 工作区 TypeScript 检查 | 领域、API、前端均通过 |
| 生产构建 | 领域、API、MUI 前端通过；Vite 产物进入现有同源 `public` 目录 |
| 领域测试 | 22/22 通过 |
| API 测试 | 88/88 通过 |
| 前端单元测试 | 14/14 通过 |
| Chromium 完整浏览器流程 | 14/14 通过；完整运行约 37.5 秒 |
| 前端格式与 Git 差异检查 | 通过 |
| 实际实例 | 4175 根页面已显示新的 MUI 登录页；原 Work 深链接保持 |

浏览器使用真实 API、临时 SQLite/Git/JSONL，以及确定性且可中止的模型夹具。没有向外部模型发送真实报告资料。流式 UI 最后的提交状态文案修订另外复测 Reflection 引用/采纳、刷新恢复、未知结果核对及停止/管理员只读四个关键场景，4/4 通过。截图、失败轨迹保存在忽略目录 `apps/workbench/test-results`。

全量 API 检查暴露了三项原有压缩测试的隐含小预算假设。它们跟随 256k 默认后不再满足“必然触发压缩”的夹具条件；已给压缩测试显式设置 32k 输入预算，并为本机 SDK 夹具加 15 秒截止，保留“不重放、精确事实、失败暂停”等断言。生产默认仍为 256k，测试同时检查该默认。修复后完整 API 测试通过。

Dockerfile 已纳入前端依赖清单和构建步骤；源文件及测试进入 Git 管理，`public/`、测试截图和外部原型被忽略。本次没有构建/发布容器镜像，容器运行验证仍需在实际部署验收中完成。

## 行为与测试映射

| 行为 | 覆盖 |
| --- | --- |
| 连续 Reflection、来源跳转、Proposal 差异/校验/明确采纳 | `apps/workbench/e2e/workbench.spec.ts` Reflection citations |
| SSE UTF-8/CRLF 分片、重复/旧 sequence、单消息替换 | `apps/workbench/src/workbench/reflection-stream.test.ts` |
| 刷新恢复且不重复发送 | 浏览器 streaming Reflection 场景 |
| 丢失提交响应保留原请求 ID、拒绝另一个问题、核对不重发 | 前端 reflection-stream 单元测试及浏览器 lost send response 场景 |
| 明确停止、部分回复、管理员只读及作者边界 | 浏览器 explicit stop 场景及原 domain/API Reflection 测试 |
| 历史 Work 分片合并且来源仍可定位、不改写输入 | `apps/workbench/src/workbench/trajectory.test.ts` |
| 私有草稿、导航保护、Rebase/放弃、组织吸收与同步、API Suggestion | 恢复的 11 个既有浏览器场景 |
| 权限撤销停止重连 | 前端 reflection-stream 单元测试 |
| 能力、原作者权限、运行/治理互斥、版本和持久化 | 原领域/API 回归，共 110 项 |

对应行为契约为 `workbench-restoration.feature`、`work-reflection-proposal.feature`；HTTP 生命周期继续遵循 `../reflection-streaming.md`。

## 设计复盘

本次恢复的发现、放置和验证路线仍在任务上下文中；原前端删除操作之前的完整开发过程不在本次上下文内，结论仅针对本次恢复。总体置信度高。

| 检查 | 结果 | 证据与未来风险 | 置信度 / 层级 |
| --- | --- | --- | --- |
| Missing Path | found，已处理 | 旧计划指向已不存在的 `prototype/src/workbench`，实际入口却是只读简版，导致 Reflection 看似权限丢失。已将生产源码恢复到既有 `apps/workbench`，更新当前文档与历史记录入口；以后应由该路由找到页面和测试，避免再次遗漏治理界面。 | high / how-level |
| Boundary Bypass | not-found | 对话、运行、Proposal 和 OM 均走原 API；管理员查看未转成作者写权限。UI 不访问 SQLite、Git active 或 App 业务命令。 | high / — |
| Unowned Capability | not-found | 页面与展示投影归工作台，运行与治理仍归现有 Forge 用例；没有新增共享业务策略或另一个运行所有者。 | high / — |

恢复闭包为：`apps/workbench` 的源码/包/配置/测试、根锁文件和工作区脚本、Docker 构建、既有同源静态响应、浏览器隔离夹具以及当前文档。原有生产目录约定足以容纳恢复；没有增加架构层或修改 AGENTS/技能。后续修改从 `../workbench.md` 的职责路由进入。
