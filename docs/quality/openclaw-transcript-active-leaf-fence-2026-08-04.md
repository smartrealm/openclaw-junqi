# OpenClaw Transcript Active Leaf 围栏对齐

日期：2026-08-04

## 结论

JunQi 现在保存 OpenClaw `sessions.list` 行与 `chat.history.sessionInfo` 返回的
`activeLeafEntryId`，并仅在普通 `chat.send` 中把已验证的值作为
`expectedLeafEntryId` 原样发送。Gateway 若在会话准入锁内发现当前 leaf 已变化，会以
`details.reason: "active-leaf-changed"` 拒绝该次发送；JunQi 保留失败消息和草稿，随后
强制刷新 `chat.history` 以取得新的官方 transcript 投影，不自动重试写入。

## 权威依据

本机官方 OpenClaw 工作树提交
`1e3880352e614116549c0a30c67a59a2d40ba259`：

- `packages/gateway-protocol/src/schema/logs-chat.ts` 定义
  `chat.send.expectedLeafEntryId` 为可选的非空字符串或 `null`。
- `src/gateway/server-methods/chat-history-handler.ts` 将当前 leaf 放入
  `chat.history.sessionInfo.activeLeafEntryId`；`sessions.list` row 亦包含该字段。
- `src/gateway/server-methods/chat-send-admission.ts` 在会话准入锁内比较当前 leaf，
  不匹配时返回 `active-leaf-changed`，不开始 Run。
- `docs/gateway/protocol.md` 明确该字段用于阻止陈旧客户端向另一个 transcript 分支发送。

## 实现边界

- `Session.activeLeafEntryId` 只保存 Gateway 返回的 string、`null` 或未知；空值和
  非法值不被猜测为 leaf。
- 会话 identity 轮换时清除 leaf，避免旧 transcript 的事实附着到新 sessionId。
- 普通 Chat 发送从当前会话投影读取 leaf。未知时省略该字段，不能伪造空 transcript。
- `sessions.steer` 是 OpenClaw 的独立中断控制 RPC，`/btw` 是不写入 transcript 的临时
  请求；二者不附带此 `chat.send` 围栏。
- Gateway 拒绝后只刷新历史。消息没有被自动重新发送，附件、草稿和用户意图仍由原有
  retry 流程保留。

## 验证

- active leaf 值与官方错误详情的严格解析回归。
- 普通发送携带 leaf、steer 不携带 leaf 的发送事务与 Gateway dispatch 回归。
- session identity 轮换清理 leaf 的 store 回归。
- `pnpm build`。
- `pnpm test -- --reporter=dot`。
- `pnpm lint`、`pnpm verify:openclaw-docs`、`git diff --check`。

## 未验证边界

- 尚未连接真实 Gateway 让两个独立桌面客户端切换同一会话 transcript branch，并验证
  拒绝、历史刷新和人工重发时间线。
- 未在 macOS、Windows、CentOS、Ubuntu 真机完成上述跨客户端场景；自动化结果不能替代
  目标平台实测。
