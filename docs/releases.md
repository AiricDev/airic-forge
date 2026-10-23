# GitHub 源码发布

Forge 作为 App 固定版本的外部组件管理。GitHub 源码发布与 Docker 镜像发布分开：本流程不推送 npm 包，不构建或发布镜像，也不表示已经完成容器验收。

## 仓库与信息边界

首次上传前确定 GitHub 所属账号/组织、仓库名、可见性与授权许可。尚未选择许可证时，不推断开源授权。上传前审查当前文件及准备推送的 Git 历史；`.gitignore` 不会移除历史中的内容。运行数据、组织 OM、用户工作树、模型密钥、业务资料、备份和本机 `.env` 不发布。

## 检查与版本

Node.js 24、pnpm 版本以根 `package.json` 的 `packageManager` 为准。执行：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm --filter @airic-forge/workbench format:check
pnpm test
pnpm --filter @airic-forge/workbench exec playwright install --with-deps chromium
pnpm test:e2e
```

`.github/workflows/ci.yml` 在推送和 PR 中执行相同检查，不访问真实 App、模型或运行数据。浏览器测试使用合成 App 和临时数据。

整个组件的消费版本由 Git 标签标识；workspace 包仍为内部构建单元，不独立发布 npm 版本。初次发布使用 `v0.1.0`，后续不移动已有标签。协议破坏性变化在发布说明中明确标出，App 升级前运行自己的适配器契约与联调测试。

## 发布流程

1. 在干净提交上完成检查，记录代码提交及验证范围，更新根目录 `CHANGELOG.md`；该文件用作 Release 草稿说明。
2. 创建带说明的 `vX.Y.Z` Git 标签，推送代码和该标签。
3. `release.yml` 重新执行全部检查，通过后使用 `git archive` 打包标签对应的已跟踪源码，生成 SHA-256 校验文件并创建 GitHub Release 草稿。
4. 核对草稿的提交、变更说明、兼容性和已执行/未执行的验收范围，再发布该 Release。运行中的组织 OM 不包含在升级包中，也不自动迁移。

草稿不等于正式发布；源码归档不包含安装依赖或编译产物。安装者从固定标签/提交获取源码，再按锁文件安装和构建。自动草稿失败时先查看工作流错误；已经创建的草稿直接修订，不重复移动标签。

## App 消费与后续镜像

App 将 Forge 标签和精确提交写入自己的发布记录，Agent 扩展与适配器仍由 App 版本控制。开发环境可以指向本机对应源码，无需 Docker build。后续完成容器验收后，另外发布组件基础镜像并记录不可变 digest；App 派生镜像固定这个 digest，不能把 `latest` 当作发布身份。
