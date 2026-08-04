# OpenClaw 原生会话分支对齐

日期：2026-08-04

## 结论

JunQi 在会话上下文栏新增按需分支面板。面板只读取 OpenClaw
`sessions.branches.list` 返回的 transcript DAG tip，并可以经用户确认调用
`sessions.branches.switch` 切换到一个已有 tip。切换确认后，JunQi 强制重载同一会话的
`chat.history` 与分支目录；不自动重发任何消息。

## 权威依据

本机官方 OpenClaw 工作树提交
`1e3880352e614116549c0a30c67a59a2d40ba259`：

- `packages/gateway-protocol/src/schema/sessions.ts` 定义 `SessionBranch`、
  `sessions.branches.list` 和 `sessions.branches.switch` 的封闭参数与结果契约。
- `src/gateway/server-methods/sessions-rewind.ts` 对尚未 materialize 的会话返回空分支列表，
  并拒绝不允许切换的会话或活动 Run。
- `ui/src/pages/chat/chat-history.ts` 的官方 Control UI 在分支切换成功后清除旧历史投影，
  并同时刷新 history 与分支列表。

## 实现边界

- `OpenClawSessionBranchesClient` 严格接受 Gateway 返回的 `leafEntryId`、`headline`、
  `messageCount`、`updatedAt` 和 `active`；不由 JunQi 推断、生成或持久化分支。
- 分支切换与 `chat.send`、会话设置和其他会话 mutation 共用会话级串行器，避免本地并发请求
  跨越同一个 Gateway 生命周期边界。
- 列表在用户打开面板时才请求。没有分支与读取失败分别展示，不以方法广告、版本号或空本地
  数据伪装为支持。
- 不接入 `sessions.rewind` 与 `sessions.fork`。JunQi 当前消息显示模型没有完整保存官方持久化
  transcript entryId，不能为破坏性操作猜测目标 entry。

## 验证

- 分支列表字段、会话范围、串行切换和畸形响应拒绝的 Node 回归测试。
- `pnpm lint`、`pnpm test -- --reporter=dot`、`pnpm build`。
- `pnpm verify:openclaw-docs`、`git diff --check`。

## 未验证边界

- 尚未在真实 Gateway 中创建多条 transcript branch，验证活动 Run 拒绝、成功切换后的 history
  重载和两台桌面客户端之间的叶节点变化。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机验证该桌面面板；自动化验证不能替代目标平台
  实测。
