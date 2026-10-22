# Pi 原生机制实施与验收

日期：2026-10-23（Asia/Shanghai）。用户批准评估与Reflection一起原生化，开发期本机执行，允许本地原生会话保存正文和图片；真实验收仅使用明确授权的新版PDF和当前模型。

## 最终行为

- Pi 1.2.0负责持久化会话、原生自动压缩、文件/命令工具、Skills及MCP/tool_search；Forge不再运行第二份摘要、输入窗口投影或逐页笔记门槛。
- 原生会话按用户、Work/Reflection和来源身份绑定；OM、工具快照和模型变化开启新epoch，保留工作文件。已绑定文件丢失明确失败；首条对话前取消不会生成指向不存在文件的绑定。
- MCP业务与治理请求仍回到原用例；保持目标绑定、权限、版本、关联、原回执、检查点与未知命令保护。桥凭据仅在内存中，运行结束关闭。
- 原生工作文件只用于临时分析与笔记；正式业务写入和OM候选保存仍通过受治理能力。无源Work的独立Reflection，其完整工具审计保留在自身原生会话；有关联Work时另记录精简runtime元数据。
- 本机工作目录不是OS安全隔离。原生bash子进程不继承模型/业务凭据环境；仍遵守已批准的开发期宿主权限约定。

## 自动回归

- Domain：23通过。
- API：141项，140通过、1跳过；最终全量无失败。
- Domain/API编译、Workbench类型检查、git diff --check通过。无前端或CertLab源码改动，未重跑其全量浏览器/Python测试。
- `pi-native-session.test.ts`使用真实Pi与本机模拟模型验证：延迟工具搜索、MCP正文/图片、笔记落盘、显式会话恢复、来源轮换、用户隔离、凭据不落盘、自动压缩后取回笔记并保存一次草稿、Reflection原生文件和受治理候选写入。
- 原生响应终止检查、Reflection过滤私有推理、App拒绝/未知结果、取消等待、检查点及重复请求保护继续通过。

## 真实资料验收

使用用户明确授权的`长存流道说明书v2.pdf`；当前配置模型及供应商不变。独立临时CertLab数据库、项目、报告和Forge运行目录位于：

`runtime/backups/pi-native-20261023/live-acceptance/`

- 完成9.6.1单条款步骤，耗时188.741秒。
- 21个不同PDF页面全部读取一次，另对第11页图12做一次region放大，共22次asset.read。没有整篇循环重读。
- 原生文件工具保存reading-notes.md（9101字节）和progress.md（2775字节）。
- assessment.save-draft提交成功1次，得到committed回执和新记录号；此前1次载荷被明确rejected，修正载荷后提交成功，不是未知结果重放。
- 已记录人工反馈检查点；未提交复核、确认或正式输出，也未访问或修改现有业务报告。
- 本次真实运行未触发上下文压缩；自动压缩及恢复由模拟回归单独验证。实际草稿保存成功不等于其专业结论已被人工接受。

可复核机器结果：`live-acceptance/live-result.json`、`live-acceptance/metrics.json`及该目录中的原生会话、Work轨迹和笔记。CLI probe为`apps/api/src/pi-native-live-probe.ts`，须由操作者显式提供已授权的临时场景与资料，不会随服务启动或测试套件自动调用外部模型。

## OM与本地服务

当前用户分支提交：`9cf469622c054353ab88aeb254884b9c6fed9d81`，修改method、material-triage、analysis-record、recovery四份文档。通过既有PersonalGitOperatingModel的prepare/验证/publish提交，组织main未改动。seed同步原生读取与笔记方法。

服务备份：`runtime/backups/pi-native-20261023/service-snapshot/`。重启前无运行Turn/Reflection；最终重启后对22张表与既有JSONL指纹核对，全部未变。Forge PID为18541，`/health`与`/works`均200；CertLab `/api/v1/health`为200。没有自动清理旧运行文件或历史。

软件修改未提交，保留用户已有暂存改动；本次只提交了已授权的用户OM分支。

## 设计复核

沿用post-change-design-reflection技能，观察本轮已发生的路由与验证过程，不把通过测试当成架构或专业判断正确的证明。

| 检查 | 结果 | 证据与未来风险 | 置信度 |
| --- | --- | --- | --- |
| Missing Path | not-found | 以现有Pi适配器为入口，核对安装版SDK声明、会话/MCP文档和示例，再沿AgentRunnerPort找到Work/Reflection用例。网络旧README与安装版能力不一致，已以1.2.0声明及真实原生测试为准；后续应从执行契约进入该路径，避免据旧资料重造机制。 | high |
| Boundary Bypass | not-found | 桥调用既有用例，不读取业务DB；正式候选保存仍经原治理回调。原生命令具有宿主权限是用户明确选择的开发假设，不被描述为安全隔离。今后容器化需重新验证该边界。 | high |
| Unowned Capability | not-found | 通用会话机制集中于pi-native-session，MCP交付集中于work-mcp-bridge，业务与治理仍由原有用例拥有；没有保留两套摘要或笔记服务。 | high |

本轮闭包内未发现需要追加修复的架构归属问题。真实模型仍存在一次载荷修正和专业结论待人工校准的事实，不由本报告掩盖。
