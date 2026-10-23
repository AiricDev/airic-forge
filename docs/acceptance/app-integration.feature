# 需求规格；自动化、本机演练及未执行的镜像验收见 app-integration-record.md。
# I-xx 对应 docs/app-integration.md 的稳定需求编号。
Feature: App 组装 Forge 并独立演化组织 OM

  Scenario: App读取指导与通用笔记不要求领域OM提供操作细节 (I-01)
    Given 两个不同领域的 App 提供符合文档读取契约的工具
    And 两个组织 OM 仅包含各自业务判断和证据要求
    When 相同版本的基础Agent根据各自App MCP指导处理大型图文PDF
    Then Agent 能定位范围并按需读取原文和图像
    And 能记录来源、事实、疑点、覆盖范围和下一步
    And 压缩后能接续任务并产出可核对的业务草稿
    And 不要求向 OM 添加分页、笔记或压缩操作流程

  Scenario: 资料不可读时不推断事实缺失 (I-01, I-07)
    Given PDF 包含无可提取文字层的可见内容
    When Agent 需要核对此处事实
    Then 按能力范围查看页面或局部图像
    And 无法辨认的内容明确作为限制
    And 不把文字为空或检索未命中当作原件没有该事实

  Scenario: App 拒绝仍是业务决定 (I-02, I-05)
    Given 当前用户能够打开 Copilot 但没有某项专业写权限
    When Agent 请求该业务操作
    Then App 原用例拒绝且不产生业务效果
    And Forge 不通过 OM 或自身管理员角色绕过拒绝

  Scenario: 只加载明确部署的资源 (I-03, I-04)
    Given App 发布声明一组固定版本的 Pi 包和 Skills
    And 宿主个人目录与 Work 中存在其他扩展配置
    When Forge 装配一次运行
    Then 只加载声明范围内的资源并记录实际身份
    And 不把 OM 或工作文件当作可执行扩展配置
    And 普通 Turn 不安装或更新依赖

  Scenario: 资源不完整时给出诊断 (I-04)
    Given 部署声明的扩展缺少必需的系统程序
    When 执行环境准备或校验
    Then 可以定位缺失项和来源
    And 不静默略过扩展并宣称配置完整

  Scenario: Reflection 保持独立资源和授权 (I-04, I-09)
    Given Work 配置了业务资料工具和通用笔记能力
    When 为 Reflection 装配环境
    Then 使用其明确选择的资源及轨迹和候选稿治理能力
    And 不继承 Work 的 App token 或业务桥
    And 正式候选稿经既有治理工具保存

  Scenario: 恢复正确用户的业务 Work (I-05)
    Given 用户在某业务对象下已有Work
    When 该用户重新认证并打开该对象的Copilot
    Then 恢复正确归属的 Work 和历史
    And 页面选择只作为聚焦提示
    And 其他用户或其他对象不能借绑定读取此 Work

  Scenario: 重复初始化与发布种子不重置生效 OM (I-06)
    Given 组织已从种子 A 初始化并采用个人和组织修改
    When 重复初始化或使用带种子 B 的新软件启动
    Then 不重复建号或覆盖既有分支
    And 保留种子来源和已有修订
    And 种子 B 的改进须显式比较并通过治理采用

  Scenario: 能力配置变化后建立可解释的接续 (I-07, I-10)
    Given Work 有原生会话、来源笔记和业务回执
    When 开发者完成扩展修改并在无运行任务时重载或重启
    Then 下一次运行显示新的实际资源身份
    And 必要时创建新的原生会话关联
    And 旧会话和工作文件保留
    And 重新核对业务事实及未决命令后按需接续

  Scenario: 断连与未知业务结果不触发自动重放 (I-02, I-08)
    Given 一个业务命令已发出但结果尚未确定
    When 浏览器断连或 Forge 进程停止
    Then 撤销短期授权并保留可核对的命令身份
    And 不合成成功或无效果的结果
    When 用户重新认证并继续
    Then 先查询原命令的原始回执
    And 结果未明时继续阻止业务写入

  Scenario: 修改业务 OM 不需要发布软件 (I-09)
    Given 当前部署具备业务方法所需的能力
    When 用户通过治理采用新的专业判断方法
    Then 下一轮使用新 OM 修订
    And 无需构建镜像或安装扩展
    And 既有 Turn 的来源不被改写

  Scenario: 本地联调无需 Docker 构建 (I-10)
    Given 独立开发数据和已经准备好的锁定依赖
    When 开发者启动本地 App API/MCP、Forge 和前端并修改工具或 Skill
    Then 通过明确重载或相关服务重启可以观察修改
    And 不要求 Docker build 或重建 OM
    And 不终止其他服务或使用真实业务数据库
    And 重启后可以继续既有开发 Work

  Scenario: 发布产物沿用本地验证的契约 (I-03, I-11)
    Given 本地验证通过的 App 配置和能力版本
    When 构建固定 Forge 版本的发布产物并在新环境启动
    Then 使用相同资源选择与授权恢复契约
    And 服务地址、Secret 与运行路径通过环境配置提供
    And Agent 发布配置只读且 OM 和数据独立持久化
    And 实际依赖解析结果可追溯且不在 Turn 中追踪更新

  Scenario: 升级前发现组合不兼容 (I-11)
    Given 当前组织任务需要一项新发布中缺失的能力
    When 验证软件、配置、工具和当前 OM 的组合
    Then 通过配置校验或代表任务测试定位不兼容
    And 不以 WD 工具授权名单代替业务权限
    And 不自动改写组织 OM 来掩盖问题

  Scenario: 不兼容的存储不能仅回滚镜像 (I-12)
    Given 新软件已经执行旧软件无法读取的存储迁移
    When 运维尝试只换回旧镜像
    Then 明确报告兼容限制和恢复路径
    And 不自动回退 OM 或抹去 App 已提交的业务效果

  Scenario: 在不同目录恢复完整工作 (I-12)
    Given 含 OM、数据库、轨迹、原生会话、工作文件及 App 恢复点的备份
    When 在隔离的不同目录恢复并执行路径校验或修复
    Then 旧 Work、候选稿、OM 修订和原业务回执均可核对
    And 显式会话绑定仍能定位正确来源
    And 不扫描最近会话来伪造恢复
    And 业务调用需要重新认证
