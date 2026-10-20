# 个人 OM：草稿直接提交与原生 Git

本文取代旧设计中个人 Proposal 的创建、审阅、采纳和组织同步流程。组织贡献、管理员审阅和吸收到组织 OM 的治理流程不变。

## 工作台

- **改进工作方式**：可直接开始独立 Reflection，也可从某个 Work 进入。独立讨论不制造 Work 或报告记录。
- 普通问答不自动改 OM。用户明确要求准备改动即可生成私有草稿，不要求先选 Lens 或提供轨迹引用。引用 Work 事件时仍验证来源；可选 Lens 仍限制对应类型的改动。API Suggestion 不修改 OM 或授予工具权限。
- **OM 改动**展示提交前后内容，可以调整、删除文件、丢弃草稿或确认提交。保存草稿不会改变生效版本；确认提交直接更新个人 OM，没有个人 Proposal。
- 生效版本变动后必须合并最新版本、解决冲突，再确认提交。浏览器提交带内容摘要和请求 ID，丢失响应后可安全重试。
- **个人 OM**提供手动编辑和组织同步草稿。组织同步同样先查看差异，再直接提交；不会另建 Proposal。
- 既有 Work/Turn 固定的 OM 修订不改写，后续工作使用新的个人版本。个人修改不会自动进入组织 OM。

## 本地 agent 与 Git

1. 打开 **本地 agent 与 Git**，创建访问令牌。密钥只显示一次，服务端只保存摘要；可随时撤销，默认有效期 90 天。
2. 复制页面提供的 clone 地址，使用系统 Git：

   ```sh
   git clone https://forge.example/git/personal/USER_ID.git personal-om
   cd personal-om
   ```

3. 按 Git 提示输入用户名和访问令牌。使用操作系统的安全凭据管理器，不把令牌放进地址、脚本或 OM 文件。
4. 让外部 agent 编辑 OM，检查内容，再执行 `git add`、`git commit` 和 `git push origin main`。成功 push 就是采用，不需要网页再次确认。
5. 服务端已有更新时先 `git pull --rebase`，解决冲突，再 push。不要强推。

令牌绑定所有者，不能访问他人的仓库。客户端只有 `main`，由服务端固定映射到该用户的个人分支；提交作者、URL 和客户端 ref 都不能改变授权。即使是管理员，个人令牌也不能代替别的用户推送。

每次传输使用隔离对象库，不直接提供共享仓库。禁止额外分支、标签、删除、非快进、符号链接、子模块及 OM 目录之外的文件；检查新历史中的每个树，而不只检查最终差异。网页提交和 Git push 都通过相同的个人 OM 校验和发布边界。

仅 OM 文档进入版本库，不应加入报告原件、轨迹、数据库或凭据。路径限制不等于秘密扫描，提交前仍需检查文档内容。

## HTTPS 部署

远程 Git 必须走 HTTPS，只有真正的本机连接可以使用 HTTP。配置：

- `FORGE_PUBLIC_URL=https://forge.example`：公开地址，也用于生成 clone 地址。
- `FORGE_TRUST_PROXY=127.0.0.1`：仅当 TLS 由该受信代理终止时设置。容器部署应填写实际受信代理地址或网段，不要信任任意来源。
- 代理保留 Git 请求路径、认证头、内容类型和响应体，并提供 `X-Forwarded-Proto: https`。后端端口不得直接暴露给非受信网络。

Git 上传最多 16 MiB，每个 OM 文件最多 100,000 UTF-8 字节；还有历史、树大小和传输时长限制。使用维护中的 Git 版本。个人写入锁是单 API 进程内的锁，不支持多个 API 进程同时写同一个工作目录。

## 升级旧数据

先构建新版本。**应用迁移前停止 API，并备份 OM 仓库和整个 data 目录。** 不要对运行中的实例直接执行迁移。

只读预览：

```sh
node scripts/migrate-personal-om.mjs --project /absolute/om/project --data /absolute/forge/data
```

确认报告后应用：

```sh
node scripts/migrate-personal-om.mjs --project /absolute/om/project --data /absolute/forge/data --apply
```

旧手动草稿转为手动工作区；可恢复的未完成个人 Proposal 转为对应的 Reflection 或归档草稿，不自动提交。重复来源不会覆盖已存在的草稿，迁移日志防止重跑时复活已处理的数据。`needs-manual-recovery` 表示需要人工处理，命令会返回非零状态；保留备份与报告，不要丢弃旧数据。

历史提交、来源及旧统计保留。旧个人 Proposal API 已移除；历史设计与验收记录中的 Proposal 流程不再描述当前个人 OM 行为。当前行为规范见 `acceptance/om-direct-commit.feature`。
