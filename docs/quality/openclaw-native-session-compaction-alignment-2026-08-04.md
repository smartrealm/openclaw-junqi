# OpenClaw 原生会话压缩对齐

日期：2026-08-04

## 结论

JunQi 的手动上下文压缩已改为调用 OpenClaw 官方 `sessions.compact`，不再把 `/compact` 当作普通 `chat.send` 文本发送。压缩是 Gateway 管理操作，JunQi 通过已有的临时 `operator.admin` 连接执行，授权、配对和失败语义继续由 Gateway 负责。

## 权威依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw session schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)
- [OpenClaw sessions.compact handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-compact.ts)
- [OpenClaw compaction concept](https://github.com/openclaw/openclaw/blob/main/docs/concepts/compaction.md)

当前官方请求字段是必填 `key`，以及可选 `agentId`、`maxLines`；官方方法目录将 `sessions.compact` 标为 `operator.admin`。响应的稳定字段是 `ok`、规范化后的 `key`、`compacted` 和可选 `reason`。Gateway 还可能返回官方扩展字段，客户端不把未确认字段当作业务状态。

## 当前行为

- `OpenClawSessionCompactionClient` 只负责官方请求字段和最小响应解码，并要求响应的
  canonical `key` 与本次请求目标完全一致；不一致时拒绝呈现任何压缩结果。
- `gateway.compactSession` 通过 `sessionCommandCoordinator` 串行化同一 session 的维护操作，再走 `requestPrivileged`；不会复用普通 `chat.send` 或生成伪造的 idempotency key。
- Dashboard 和命令面板只会对当前明确选择的 OpenClaw session 发起压缩。没有活动 session 时，
  显示本地化错误且不发送 RPC；不再回退到硬编码的主会话。
- `compacted: true` 才显示完成；当前官方 CLI 明确的
  `result.details.pending: true` 显示为 Gateway 已接纳、等待终态；其他
  `compacted: false` 显示 Gateway 返回的 no-op 原因；RPC 错误进入既有失败和授权提示。
- `session.operation` 仍由主连接的会话订阅接收并投影为本地压缩事件。Native compaction RPC 的返回值与实时事件不互相替代。
- `/compact` 仍可作为用户发给 OpenClaw 的普通文本指令存在，但 JunQi 的“压缩上下文”按钮、命令面板动作和 Dashboard 快捷动作不再依赖该文本。

## 边界

OpenClaw 负责是否允许压缩、活动运行冲突、排队任务冲突、memory flush、摘要生成、持久 transcript 和 checkpoint。JunQi 不在本地重实现摘要，不修改 transcript，不把 no-op 当作成功，也不把临时 admin 授权升级为日常连接权限。

## 验证结果

- `OpenClawSessionCompactionClient.test.ts` 覆盖官方请求字段、完成结果、no-op 原因、非法响应和
  回执 session key 漂移。
- `OpenClawSessionCompactionClient.test.ts` 与 `sessionCompactionFeedback.test.ts` 还覆盖
  Gateway 已接纳的异步 pending、显式活动 session 目标和缺失目标的本地化反馈，确保它们不被误报为
  no-op 或完成。
- Dashboard 交互回归确认调用 `sessions.compact`，不再发送 `message: '/compact'`。
- TypeScript、全量测试、生产构建、官方文档链接、协作插件、Rust、格式和差异检查通过。
- 本次目标围栏回归共 20 项通过；`pnpm lint`、`pnpm test`、`pnpm build`、
  `pnpm verify:openclaw-docs` 与 `git diff --check` 通过。完整测试仅输出既有 Node
  弃用提示，没有失败项。

## 未验证边界

- 尚未连接真实 Gateway 验证管理员配对、活动 Run 冲突、队列冲突和不同 agent scope 下的现场响应。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机执行压缩 UI 和后台连接验收。
- OpenClaw 官方 schema 或权限目录变化时，必须重新核对源码后更新客户端。
