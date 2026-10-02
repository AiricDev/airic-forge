# 阶段验收执行记录

p0-stages.feature 是行为合同草案，按开发计划的阶段 1–5 分组。执行时为每个场景记录日期、环境、操作者、实际结果和证据位置：浏览器录屏或截图、Forge Work/Turn/Action ID、Git commit、CertReporter commandId/回执及服务日志。每个阶段只在其全部场景通过后关闭；单元测试或协议夹具通过不代表浏览器验收通过。

阶段 0 的可执行协议夹具为 apps/api/src/certreporter-contract.test.ts。它覆盖 bearer 身份、OpenAPI、能力 manifest、report.context、响应丢失后的回执查询与 token 撤销。CertReporter 自身的 tests/api/test_airic_domain_protocol.py 负责验证真实业务端点。两套测试验证契约两端，阶段 2 仍需在真实服务之间执行上述场景。

阶段 1 的容器、账户、权限、重启和浏览器结果见 stage-1-record.md。App 身份由容器内 CertReporter 协议夹具提供，真实 Report 页面与命令流属于阶段 2。
