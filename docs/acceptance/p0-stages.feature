# P0 行为验收草案。每个场景须在对应阶段的真实浏览器、Forge 服务和 CertReporter 中执行并保存证据。
# 合同夹具 apps/api/src/certreporter-contract.test.ts 只证明协议形状，不替代以下端到端结果。

Feature: 阶段 1 可部署的身份与个人 OM

  Scenario: 同一 App 身份恢复同一用户和个人版本
    Given Forge 的 project 与 data 目录为空
    And CertReporter 中存在可访问目标 Report 的用户甲
    When 用户甲从该 Report 两次进入 Forge
    Then Forge 只有一个规范化 Email 对应的用户甲
    And 第二次进入恢复同一个未结束 Work 和 Session
    And 用户甲有独立的个人分支与 worktree
    And 用户甲的个人 HEAD 可从工作台读取

  Scenario: 普通用户隔离与管理员只读访问
    Given 用户甲和用户乙各有个人 OM 和 Work
    And 管理员没有用户甲的 CertReporter bearer token
    When 用户乙尝试读取用户甲的 OM、Work 或轨迹
    Then Forge 拒绝访问
    When 管理员读取用户甲的资源
    Then 资源仍属于用户甲
    And 管理员不能因此执行用户甲的 Report 命令

  Scenario: 身份和 OM 在重启后恢复
    Given 用户甲已设置 Forge 独立密码并有个人 OM
    When Forge 重启并重新打开已有 project 与 data
    Then 用户甲可以使用 Forge Web 会话登录
    And 用户甲的个人 HEAD、Work 和 Session ID 未改变
    And 旧 App bearer token 不从持久化数据恢复

Feature: 阶段 2 CertReporter 中可追溯的 Work

  Scenario: 未接受或已变化的能力目录阻止新 Turn
    Given CertReporter 提供能力目录和 OpenAPI
    When 管理员导入目录但尚未接受
    Then Work Agent 不获得任何报告命令能力
    When 管理员接受该目录版本
    And CertReporter 随后改变目录 digest
    Then 下一 Turn 拒绝执行并显示目录变化
    And 旧 Turn 继续引用原目录 digest

  Scenario: 受允许的报告更新得到真实回执
    Given 用户甲可编辑一个 Draft Report
    And Forge 已接受的能力目录包含 report.update-master
    And report-authoring WD 允许该能力
    When 用户甲请求保存一个有依据的报告字段
    Then Agent 只通过 CertReporter Command API 提交带 commandId 和 expectedRevision 的命令
    And CertReporter 回执表明提交成功后页面刷新
    And Turn 可查到 OM HEAD、目录 digest、上下文来源和该回执

  Scenario: 失效权限与错误目标不能产生第二次业务效果
    Given 一个命令已送往 CertReporter 但响应丢失
    When Forge 使用原 commandId 查询回执
    Then Forge 显示原命令的结果且不重放变更
    When 当前 App token 被撤销或请求跨 Report 目标
    Then CertReporter 拒绝后续业务调用
    And Forge 将拒绝或未知状态保留在轨迹中

  Scenario: ACP 断线和重启仍可读历史
    Given Work 已有 Turn 和 Action 轨迹
    When ACP 断线或 Forge 重启
    Then 旧轨迹和回执仍可查询
    And 新的业务命令需要重新 bootstrap 才能使用当前 App token

Feature: 阶段 3 个人 OM 提议与采纳

  Scenario: 未采纳 Proposal 不改变运行版本
    Given 用户甲有个人 active HEAD
    And 一个独立 Proposal worktree 中有未采纳的 work.yml 或 SK 修改
    When 用户甲开始下一 Turn
    Then Turn 仍使用 active HEAD 中的文档
    And 用户乙的 OM 不变

  Scenario: 作者采纳后下一 Turn 使用新 HEAD
    Given Proposal 的 base 等于用户甲当前 active HEAD
    And 用户甲已审阅差异、来源、证据与检查结果
    When 用户甲采纳 Proposal
    Then 产生带来源、证据和 base trailer 的合并提交
    And 已有 Turn 继续引用旧修订
    And 下一 Turn 引用新的 active HEAD

  Scenario: 并行 Proposal 的过期基准被拒绝
    Given 两个 Proposal 均基于同一用户的同一个 active HEAD
    When 用户先采纳其中一个 Proposal
    And 再尝试采纳另一个 Proposal
    Then 第二次采纳被拒绝且保留候选工作区
    And 用户须 rebase、重新校验和重新审阅

Feature: 阶段 4 基于轨迹的 Reflection

  Scenario: 三种内置 lens 与无 Proposal 结果
    Given 用户甲有可访问的 Work 轨迹
    When 用户甲选择来源事件并分别运行 Domain Knowledge、Delegation Gap 和 API Suggestion
    Then 每次 Reflection 记录 lens 版本和来源证据
    And 只有需要修改 OM 的结果才产生 Proposal
    And API Suggestion 可导出且不进入可调用能力目录

  Scenario: 证据边界与无证据结果
    Given 用户甲可读取自己的 Work 且不能读取用户乙的 Work
    When 用户甲以用户乙的事件或不存在的事件发起 Reflection
    Then 请求被拒绝且不创建 Reflection
    When 用户甲不选择证据发起 Reflection
    Then 分析被保存但不创建空 Proposal 或 API Suggestion

  Scenario: lens 管理与版本快照
    Given 管理员可以查看三种固定 lens
    When 管理员停用一个 lens 或修改其提示词
    Then 新 Reflection 遵循启停状态并记录新的 lens 版本
    And 已有 Reflection 保留原版本和分析记录

  Scenario: 并发 Reflection 不混写
    Given 同一用户从同一 Work 发起两个 Reflection
    When 两个 Reflection 都提出 OM 修改
    Then 每个 Proposal 有自己的分支、base 和 worktree
    And 任一修改不会覆盖另一个 Proposal 或个人工作区

Feature: 阶段 5 P0 交付与恢复

  Scenario: 三份持久数据协同恢复
    Given CertReporter 与 Forge 已形成 Report 回执、Work 轨迹、个人 HEAD 和未完成 Proposal
    When 按恢复点备份并还原 Forge project、Forge data 和 CertReporter 数据
    Then 同一用户可以重新找到旧 Work、Turn 和 Proposal
    And 旧 Turn 的 OM 来源与 App 回执仍可查
    And 未知命令仍按原 commandId 恢复而不重复执行

  Scenario: 损坏的备份不能进入恢复目录
    Given 同一恢复点包含 Forge project、Forge data 和 CertReporter 数据
    When 任一归档的校验值不匹配
    Then 恢复被拒绝且现有数据不被覆盖

  Scenario: P0 Report 部署不依赖旧 sidecar
    Given CertReporter 的 Report Drawer 使用 Forge ACP
    When 以阶段 5 同机 Compose 启动且旧 Airic sidecar 显式禁用
    Then Forge 和 CertReporter 的健康检查不需要旧 sidecar 端口或内部签名密钥
    And Report Work 仍可通过 App bearer token 启动与恢复
