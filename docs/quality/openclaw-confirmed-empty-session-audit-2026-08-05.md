# OpenClaw 已确认空会话首发审计

日期：2026-08-05

## 审计范围

本次审计覆盖 `sessions.create -> 本地会话提交 -> 活动会话历史读取 -> 文本或语音首发 -> chat.send leaf CAS -> 历史刷新` 全链路。

## 权威依据

- OpenClaw 官方 Gateway protocol 文档：`sessions.create` 创建会话条目；`chat.history` 与 `chat.send` 是会话执行方法；`chat.send.expectedLeafEntryId` 支持 `null` 断言空 transcript leaf。
- OpenClaw 官方源码：`packages/gateway-protocol/src/schema/sessions-create.ts` 定义 `agentId`、`fork`、`message` 与附件；`src/gateway/server-methods/session-create-initial-turn.ts` 定义初始 turn；`src/gateway/session-create-service.ts` 仅在 `fork: true` 时复制父 transcript；`packages/gateway-protocol/src/schema/sessions-row.ts` 定义 nullable `activeLeafEntryId`。

## 根因

JunQi 的 `sessionCreate` 在 Gateway 返回 `key`、`sessionId` 和 entry 后已正确提交本地会话，并保留请求目标 `agentId`。但它没有投影“创建无初始 turn 且没有 fork”的空 transcript 事实，导致本地 `activeLeafEntryId` 为未知。

`ChatView` 将“切换会话”或“活动消息为空”一概视为必须先读取 `chat.history`。`MessageInput`、`useMessageSend` 与 `JarvisVoiceRuntime` 又把这一前台读取作为发送门禁。因此新会话不会继承旧历史，但会在历史读取进行期间无法发送；读取失败时首发也被拒绝。

## 修复设计

- 在 Gateway 确认创建边界，为非 fork 创建投影 `activeLeafEntryId: null`。该字段随同一 `Session` 保存，身份轮换现有逻辑会清除它。
- 在 UI 仅根据 `sessionId`、`agentId` 与 `activeLeafEntryId === null` 的确认会话跳过首发历史预热。没有该事实的任何会话继续读取权威历史。
- 发送事务已经在普通发送中传递非 `undefined` 的 active leaf，因此 `null` 将原样成为 Gateway CAS 参数。Gateway 成功受理后清除本地 null，后续 leaf 只接受 Gateway 历史或会话投影。
- Gateway 返回 active-leaf 变化错误时，保留既有后台 `chat.history` 刷新；不在客户端合成 leaf 或消息。

## 验证状态

- [x] 已完成源码与协议核对。
- [x] 已完成实现与 19 个定向回归测试。
- [x] `pnpm lint`、生产构建、`git diff --check` 与本次修改文件 Emoji 扫描通过。
- [ ] `pnpm test` 未通过：未修改的 `src/theme/tailwindThemeBridge.test.ts` 在“semantic color aliases preserve the storage type of their source token”失败；本次 diff 未包含主题 CSS 或该测试，待独立处理。
- [ ] macOS、Windows、Ubuntu、CentOS 真实 Gateway 桌面验收待执行。
