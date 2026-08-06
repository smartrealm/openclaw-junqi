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
- `SessionRowSchema` 允许 `agentId` 缺省；JunQi 使用官方 `agent:<agentId>:...` session key 仅作身份投影，不能把缺省字段误判为身份变化。

## 验证状态

- [x] 已完成源码与协议核对。
- [x] 已完成实现与 19 个定向回归测试。
- [x] `pnpm lint`、生产构建、`git diff --check` 与本次修改文件 Emoji 扫描通过。
- [x] `pnpm test`：全套前端与脚本测试通过。
- [ ] macOS、Windows、Ubuntu、CentOS 真实 Gateway 桌面验收待执行。

## 后续协调修复（2026-08-05）

再次以本地 OpenClaw 官方源码提交 `1e3880352e6` 对照创建链路。官方 UI 的
`createResult` 在 `sessions.create` 确认后执行 `refreshReplacement`，随后才通知创建完成；
Gateway 会话行中的 `activeLeafEntryId` 为可空字段。

JunQi 在本地立即提交已确认的创建结果，再接收 `sessions.list`。此前同一会话身份的稀疏列表行
若省略 `activeLeafEntryId`，会覆盖创建时已确认的 `null`。这不是 Gateway 已确认 transcript
变化，却会让 Chat 首屏重新进入历史加载和首发门禁。

现在会话合并只在 key、sessionId、agentId 三者均一致，且列表未给出任何 leaf 时保留该 `null`。
Gateway 明确返回 leaf、identity 变化或 identity 缺失时不保留，继续以 Gateway 数据为准。该规则
只稳定创建与列表协调之间的短暂事实，不在客户端推导或伪造 transcript 状态。

### 本次验证

- [x] `node --import ./test-setup.ts --import tsx --test src/utils/confirmedEmptyTranscript.test.ts src/stores/chatStore.test.ts src/utils/sessionCreate.test.ts src/components/Chat/newSessionEntryContracts.test.ts`：64 项通过。
- [x] `pnpm lint`：模块边界、版本一致性与 TypeScript 检查通过。
- [x] `git diff --check` 与全仓 Emoji 扫描通过。
- [ ] macOS、Windows、Ubuntu、CentOS 真实 Gateway 桌面验收仍待执行。

## 当前复核（2026-08-07）

复核发现新建会话在 `sessions.list` 回刷后重新进入历史加载门禁：官方稀疏列表行没有 `agentId`，JunQi 旧合并逻辑将其与创建时身份视为不一致，抹除了已确认的 `activeLeafEntryId: null`。

修复为：会话投影从官方 session key 的 agent 段补齐身份；创建确认与稀疏列表合并也以该派生身份核对。这样不会新增 OpenClaw 字段或本地会话语义，只恢复同一官方会话的创建确认事实。

### 当前复核验证

- [x] `confirmedEmptyTranscript` 与 `openClawSessionProjection` 定向回归测试通过。
- [x] `pnpm lint` 通过。
- [ ] 完整前端测试、Rust 测试、生产构建和桌面安装包验证待本次复核完成。
