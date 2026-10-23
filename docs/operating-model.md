# Operating Model：业务方法、文档路由与治理

OM 是组织和个人可独立演化的业务知识与工作方法，不是 Agent 运行配置。Git 是其内容与修订的事实来源。

## 边界

OM 可以描述专业判断、证据充分性、组织责任、标准例外和人工交接。大型 PDF 如何分块、图文选择、阅读笔记和压缩后续读属于通用 Agent 能力，不应要求组织在 OM 中重新实现。

OM 不保存当前业务记录、原始资料、会话、临时笔记、插件依赖或凭据。业务事实由 App 管理，执行状态由 Pi/Forge 管理。实例配置与 OM 的分离要求见 [App 集成](app-integration.md)。现有阅读细节的迁出仍按该实施计划完成，本轮不自动修改用户或组织生效 OM。

## 内容与格式

```text
work-definitions/<id>/
  work.yml
  policy.md
  method.md
  ...
subject-knowledge/<path>.md
precedents/<path>.md
```

WD 是一类工作的入口；Subject Knowledge（SK）是可复用的业务理解；precedents 保存带来源与适用限制的案例知识。WD 引用知识的稳定 ID，不用可变页面或本地文件路径代替身份。

当前 work.yml 格式：

```yaml
schemaVersion: 1
id: report-authoring
title: Report assessment
description: Advance the explicit report goal.
documents:
  - id: policy
    path: policy.md
    title: Business boundaries
    role: policy
    load: required
knowledge:
  bootstrap: []
  available: []
completion:
  mode: user
```

文档 role 支持 policy/procedure/reference/precedent，load 支持 required/on-demand。路径相对 WD 目录。知识文件采用 YAML front matter：id、title、summary、topics；导航 README 不作为知识条目。嵌套目录可按标准、版本及条款组织，稳定 ID 不必等于末级文件名；扁平 subject-knowledge 文件的 ID 与文件名对应。ID 必须唯一。

业务工具来自当前用户 MCP，不在 WD 维护工具权限白名单；OM 编辑不要求 MCP 在线。源码契约见 packages/domain/src/operating-model.ts。

## 路由与执行来源

每个 Turn 固定用户个人 HEAD 和实际加载文档，required 文档与 bootstrap 知识先进入上下文，on-demand/available 提供发现和按需读取。只从固定修订读取，Agent 不自行选择另一份 active 版本。

权威 App 状态、未决命令和人类纠正与 OM 分开提供。Pi 会话/工作文件支持接续，但不变成专业证据或授权。压缩采用 Pi 原生机制，不在 OM 声明另一套窗口或摘要流程。

当前 report-authoring 可通过 FORGE_REPORT_WORK_DEFINITION 映射到组织实际 WD。空 OM 可启动服务，但没有对应 WD 就不能执行工作；当前生产启动不自动从 seed 导入。面向新组织的显式种子初始化与发布更新要求见 [集成需求](app-integration.md)。

## 个人与组织治理

main 保存组织修订，users/<userId> 保存个人 active HEAD。普通保存只写草稿；作者确认提交后校验并条件快进个人分支。发生并发更新时先合并并解决冲突，历史 Turn 保留旧来源。

Reflection 可基于 Work 轨迹或独立讨论准备私有草稿，不能自动提交或替代作者。组织贡献固定来源，由管理员选择文件、验证并合入 main；成员自行同步。个人草稿、组织选择和提交理由均保留在 Git 结构及元数据中，不使用数据库 OM 内容快照。

操作、权限与原生 Git 接入见 [个人 OM](personal-om-changes.md)；资源关系见 [权限契约](contracts/resource-ownership.md)，行为规格见 [OM Git 场景](acceptance/om-git.feature)。
