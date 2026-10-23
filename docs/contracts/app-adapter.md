# App代码适配器契约

Forge是通用组件，不内置业务App客户端、业务工作类型、资料格式DTO或组织种子。App随代码发布适配器，用`FORGE_APP_ADAPTER_MODULE`显式配置，导出同步`createAppPort({config, services})`工厂。该代码与App发布版本一起管理，不从OM、工作文件或个人目录发现。工厂只构造客户端，不在加载时发起业务操作；启动校验可能多次加载。模块可以使用.mjs/.cjs；Node24也可执行只有可擦除类型语法的.ts，不支持参数属性等需转译语法或顶层异步初始化。

`apps/api/src/app-adapter.ts`提供MCP传输、公开执行元数据、schema校验及摘要等通用服务；工厂返回`packages/domain/src/ports.ts`的AppPort。App业务身份、HTTP路径、MCP业务工具名及数据结构由App实现。缺少App身份、模块、工厂或必需方法时明确失败，不回退到内置App。

| 契约 | App适配器责任 | Forge责任 |
| --- | --- | --- |
| identity | 使用当前Token获取可信身份、规范邮箱、组织与App标识 | 匹配请求App/组织，绑定Forge用户及原App用户 |
| resourceContext | 按workType/entityId取得真实上下文，检查本App可用工作类型/资源关系 | 检查resource.namespace、resourceType和resourceId的通用结构与身份 |
| discoverTools | 当前用户MCP发现、业务release与公开schema/执行元数据校验 | 每Turn固定不可变快照；检查App绑定，不使用过时快照代替发现 |
| bindInput | 注入App所需目标字段并拒绝外部目标；无需转换时可省略 | 只转交已绑定输入，不解释report/item等业务字段 |
| prepareCommand | 发出命令前核对App目标/版本/权限，返回resourceKind/resourceId/scope/targetKind/targetId | 检查定位完整，生成唯一命令ID与Work/Turn关联，记pending |
| submitCommand / receipt | 通过App用例执行；核对原回执、目标、原键及作用域，区分committed/rejected/unknown | 结果未知阻止后续写入；恢复只查询原回执，不生成新键重放 |
| auditObservation | 按App协议投影来源/覆盖/状态；去除原文、图像、敏感业务载荷 | 保存投影；未配置时记录普通JSON结果，App必须对自身敏感读取提供投影 |
| toolContent | 需要图像时提供校验后的通用text/image块，遵守模型视觉能力；可选 | 通用MCP/Pi桥传递内容；缺省为JSON文本，不根据业务工具名猜图像 |
| describeIntegration | 可选公开App/MCP地址及transport信息 | 管理员可见，禁止返回Token或模型密钥 |

命令预检失败时尚未分配命令ID，也未发出写入；记录失败后返回工具错误，允许调用者修正参数。只有已发出的pending/unknown命令才进入禁止重放的恢复规则。App的事务、幂等、专业授权及原回执仍是最终权威，Forge不复制专业规则。

Bootstrap HTTP体为`{appId,workType,entityId,selection?,workId?}`。App Work查询体为`{appId,workType,entityId}`。workType不是固定业务枚举；默认解析同名OM工作定义，配置FORGE_WORK_DEFINITION时使用部署指定的WD。选择状态只影响当前关注位置，不能改变权威资源身份。

配置Module属于受信任部署代码，拥有进程权限；组织OM只能改变治理允许的文档，不能安装、替换或选择该模块。App更新适配器必须重新构建/验证发布组合并记录部署身份。Forge镜像、数据库和源代码都不包含某个App的私有适配器或种子。

验证包括两个不相关App（库存/博物馆）的生产Runtime绑定、异构命令定位、原回执恢复、不重放及外部工具快照拒绝；实际App另行运行自身适配器契约与HTTP/MCP/浏览器验收。合成测试不证明业务专业判断正确。
