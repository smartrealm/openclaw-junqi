# OpenClaw 原生消息队列对齐审计

日期：2026-08-18

## 官方依据

本次以本机 GitHub 源码检出 `/Users/wei/DevTool/project/mine/gui/openclaw` 为依据，其 `origin` 为 `https://github.com/openclaw/openclaw.git`，审查提交为 `3075acd549a5c76ad776cd8be5edff8ee6d47b55`。

- `packages/gateway-protocol/src/schema/logs-chat.ts` 定义 `chat.send.queueMode`，合法值为 `steer`、`followup`、`collect`、`interrupt`。
- `src/gateway/server-methods/chat-send-handler.ts` 将该字段传入 Gateway 的 `queueSettings.inlineMode` 和运行时 `queueModeOverride`。
- 同一 handler 的成功回执为 `{ runId, status: "started" }`，不是客户端可推断的 `queued` 状态。
- `src/gateway/chat-queued-turns.ts` 证明 followup 与 collect 队列由 Gateway 持有取消身份；客户端没有稳定的队列列表读取契约。
- `src/gateway/server-methods/sessions-abort.ts` 定义 key-only 的 `sessions.abort` 配合 `clearQueued: true` 才会清理该会话的 Gateway followup 和 lane 队列。

## 运行时证据与结论

2026-08-18 在本机实际 Gateway 日志中，三次 `chat.send` 都返回 `INVALID_REQUEST`，错误为 `invalid chat.send params: at root: unexpected property 'queueMode'`。这是当前运行时的结构化拒绝，证明它不支持上述较新源码中的参数。

因此不能把 `queueMode: "followup"` 发给该 Gateway，也不能用 JunQi 内存队列或无语义保证的重发替代 OpenClaw 原生队列。此前的参数接入已撤回，避免普通消息全部失败。

## 当前行为与修复

- 普通消息按当前 Gateway 可接受的 `chat.send` 契约发送，不再传递被拒绝的 `queueMode`。
- 明确的转向操作继续走原生 `sessions.steer`。
- 删除 JunQi 内存 `messageQueue`、本地队首 drain、交接面板及其编辑、清空和重试路径。
- 会话重置、删除、分叉等变更进行时，客户端拒绝提交消息并保留 Composer 草稿；不会伪装为 Gateway 已排队。
- Gateway 成功回执仅投影为“已发送”；JunQi 不展示未经协议提供的队列长度、顺序或逐项状态。
- 发送准入与会话变更现在通过同一门禁原子协调：已经取得准入的发送完成 Gateway 请求前，重置、删除、分叉等变更等待；变更已排队后，后续发送立即拒绝，不会越过变更提交到旧会话。
- 已确认的发送失败原因现在显示在对应用户消息旁，并提供可访问的状态名称；不再只在鼠标悬停提示和日志中保留根因。
- 原先消息队列的 audit、spec、plan 三份记录已按文档索引规则收敛为本文件。

## 验证

- Gateway 日志已复现并定位 `queueMode` 参数拒绝。
- `pnpm lint` 通过：TypeScript、模块边界和版本一致性均通过。
- 59 项定向 Node 回归通过，覆盖普通 `chat.send` 不携带 `queueMode`、发送与会话变更的准入顺序、会话变更期间拒绝发送、失败原因展示、历史协调和 Gateway 分流。
- `git diff --check` 与三份 locale JSON 解析通过。

## 未验证边界

当前运行时不具备可调用的显式原生 followup 队列契约。只有在实际 Gateway 接受官方 `queueMode` 后，才能重新接入该能力并执行长运行多消息时序验收；在此之前，JunQi 不宣称已支持原生消息队列。本轮没有向真实 Gateway 注入测试消息。已生成 macOS ARM64 `.app`，但 updater 签名因环境缺少 `TAURI_SIGNING_PRIVATE_KEY` 未完成；该产物不可作为正式发布包。
