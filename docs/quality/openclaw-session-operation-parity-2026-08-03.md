# OpenClaw session.operation 能力对齐

日期：2026-08-03

## 依据

当前安装的 OpenClaw 版本为 `2026.7.1-2 (0790d9f)`。本轮核对随包
`server-methods-list-L_OppjbT.js`、`sessions-UcKjjh_n.js` 与控制台构建产物：

- `session.operation` 是 Gateway 广播事件；
- 当前版本的官方操作为 `compact`；
- `start` 事件携带 `operationId`、`operation`、`phase`、`sessionKey`、可选
  `agentId` 和 `ts`；
- `end` 事件额外携带 `completed`，失败时可携带 `reason`；
- 同一 operation 的 start/end 通过 `operationId` 关联。

## 当前实现

JunQi 在 `src/services/gateway/sessionOperation.ts` 中严格解析当前版本的
`compact` 载荷，拒绝缺少 operationId、sessionKey、时间戳、阶段或结束结果的事件。

`ChatHandler` 对有效事件执行以下投影：

- `start`：按 sessionKey 写入临时压缩状态，Chat 上下文栏显示正在压缩；
- 成功 `end`：清除临时状态，并插入一次上下文压缩分隔线；
- 失败 `end`：只清除临时状态，不伪造压缩成功；
- 按 sessionKey、operationId、阶段、时间戳和官方终态字段去重。完全相同的
  `session.operation` 重放不会重复更新状态或插入两个分隔线；不同阶段
  或不同操作仍会保留；
- cron 和 sub-agent 隔离会话不投影到主聊天。

## 验证结果

- `sessionOperation.test.ts` 覆盖 start、end、失败和非法操作；
- `ChatHandler.test.ts` 覆盖状态进入、成功结束、重复事件不会重复投影，以及旧 agent
  流去重；
- TypeScript 类型检查与 `git diff --check` 通过。

## 未验证边界

- 未连接真实 Gateway 实测压缩期间 start/end 的跨连接广播顺序；
- 当前安装版源码只实现并调用 `compact` 操作，未来 OpenClaw 若增加新的 operation 类型，解析器会先拒绝并需要重新核对官方契约；
- 未在 Windows、Linux 或 macOS 发布制品中做真实 Gateway 压缩和 UI 验收。
