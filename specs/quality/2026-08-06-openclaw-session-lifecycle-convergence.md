# OpenClaw 会话生命周期收敛规格

日期：2026-08-06

## 目标行为

1. 会话列表完整分页，并请求官方标题与最近消息字段。
2. 所有列表消费者使用同一严格投影，保留 `sessionId` 和全部会话组织状态。
3. 已读写入只在活动会话确实为未读时发生，同一身份的并发写入合并。
4. 新会话默认 Agent 来自 `agents.list.defaultId`；无法取得权威 Agent 时禁止创建。
5. 普通创建、完整分叉、消息分叉和检查点分支使用统一的权威会话提交入口。
6. 会话 patch 携带当前 `sessionId`，身份改变时 Gateway 必须拒绝旧写入。
7. 删除客户端 topic 持久化及其旧存储迁移，标题只来自 Gateway 行或当前内存中的已确认 transcript。
8. 删除旧 Gateway 参数兼容回退，协议不匹配时明确失败。

## 验收条件

- [ ] `sessionId` 单独变化会更新 Gateway 状态仓。
- [ ] 已读会话列表刷新不会调用 `sessions.patch`。
- [ ] 列表请求分页至 `hasMore` 为 false，并请求官方标题与消息预览。
- [ ] `derivedTitle`、`displayName` 和 `lastMessagePreview` 进入所有会话展示投影。
- [ ] 非 `main` 默认智能体可用于新建会话，缺失默认值时不伪造 Agent。
- [ ] 所有分叉路径取得新会话的 `sessionId` 后才提交到桌面状态仓。
- [ ] 会话组织和标签写入传递 `expectedSessionId`。
- [ ] 固定分叉标签、本地 topic 存储和旧 Gateway 回退代码被删除。
- [ ] 相关测试、`pnpm lint`、`pnpm test`、`pnpm build` 与 `git diff --check` 通过。

## 未验证边界

macOS、Windows、CentOS 和 Ubuntu 的真实 Gateway 多客户端并发行为仍需桌面制品验收。

## 本轮验证记录

- 已通过：会话列表、Agent 默认值、Gateway 状态仓、ChatStore、重命名、Dashboard 新建会话相关回归测试，以及源码全量测试（2841 项）。
- 已通过：`tsc --noEmit`、模块边界检查、版本一致性检查、`git diff --check`、直接 `vite build`。
- 未验证：`pnpm` 因 Corepack 签名校验无法启动，因此未直接执行 `pnpm lint`、`pnpm test` 或完整 `pnpm build`；已分别运行其对应的本地可执行检查。
