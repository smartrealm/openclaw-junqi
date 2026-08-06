# OpenClaw 已确认空会话首发规格

日期：2026-08-05

## 依据

- OpenClaw Gateway `sessions.create` 接收 `agentId`、可选 `message` 与可选 `fork`；`fork: true` 是复制父 transcript 的唯一显式请求。
- 当前 OpenClaw Gateway 源码的 `resolveSessionCreateInitialTurn` 将未提供有效 `message`、`task` 或附件的创建标记为无初始 turn。
- Gateway 会话行与 `chat.send` 契约都允许 `activeLeafEntryId: null`；`chat.send.expectedLeafEntryId: null` 是对权威空 transcript leaf 的并发断言。

## BUG-NS-06：已确认空会话不应被历史读取阻塞

当前：JunQi 在 `sessions.create` 成功后激活新会话，但未投影空 transcript leaf。`ChatView` 会对任意空消息列表启动前台 `chat.history`；输入框、语音入口和首发逻辑将该读取当作前置条件。网络请求延迟或失败时，用户无法在刚创建的会话中发送。

目标：仅当 Gateway 已确认创建、创建请求未含初始 turn 且未请求 transcript fork 时，JunQi 将该会话的 `activeLeafEntryId` 投影为 `null`。该事实必须随会话的 `sessionId` 和创建时的 `agentId` 一起保留在同一会话投影中。文本和语音首发可直接发送，且普通发送把 `null` 原样传给 Gateway 的 `expectedLeafEntryId`。

非目标：不新增 Gateway RPC、事件、会话状态或本地队列语义；不猜测其他客户端写入、未知 leaf、fork transcript 或初始 turn 的历史。上述场景仍执行既有 `chat.history` 同步。

## 验收

- [x] `sessions.create` 请求中的 `agentId` 原样绑定到本地确认会话，且会话身份来自 Gateway 的 `key` 与 `sessionId`。
- [x] 非 fork、无初始 turn 的确认创建投影 `activeLeafEntryId: null`；fork 不投影空 leaf。
- [x] 已确认空会话切换或首次连接时不启动前台 `chat.history`，文本与语音入口保持可用。
- [x] 首次普通发送传递 `expectedLeafEntryId: null`；Gateway 受理后本地不再把该 null 当作当前 leaf。
- [x] 身份轮换、Gateway 历史投影、会话删除和 Gateway active-leaf 冲突继续按既有生命周期清理或刷新。
- [x] 未确认、未知 leaf、fork 或初始 turn 会话仍在首发前读取权威历史。
- [x] 同一 key、sessionId 且由官方 session key 推导出同一 agent 的稀疏 `sessions.list` 行不得抹除创建确认的空 leaf；Gateway
  明确给出 leaf 或 key、sessionId、agent 身份不一致时必须以 Gateway 投影为准。

## 平台与运行时边界

本变更仅涉及 React 端的 Gateway 协议投影和发送协调器，不修改 Rust/Tauri command、Native/Docker 运行时选择或系统平台 API。macOS、Windows、Ubuntu 与 CentOS 的真实 Gateway 端到端桌面验收需要分别在对应运行时完成。
