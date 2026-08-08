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

修复为：会话投影从官方 session key 的 agent 段补齐身份；创建确认与稀疏列表合并也以该派生身份核对。对同一 key 的列表行，只有 Gateway 明确返回新的 sessionId、agent 或 leaf 时才覆盖创建确认；缺省字段继续保留已确认身份。这样不会新增 OpenClaw 字段或本地会话语义，只恢复同一官方会话的创建确认事实。

### 当前复核验证

- [x] `confirmedEmptyTranscript` 与 `openClawSessionProjection` 定向回归测试通过。
- [x] `chatStore` 覆盖仅含 key 的轻量 `sessions.list` 行不会清除创建身份和空 leaf。
- [x] `pnpm lint` 通过。
- [ ] 完整前端测试、Rust 测试、生产构建和桌面安装包验证待本次复核完成。

## 2026-08-07 官方源码交叉审计

本次复核使用本地 OpenClaw 官方仓库 `https://github.com/openclaw/openclaw`，源码提交为
`1e3880352e614116549c0a30c67a59a2d40ba259`，并逐项核对协议 schema、Gateway handler、会话行投影
和官方控制台的新建会话调用。本节记录审计结论及本次修复结果。

### 已确认与原生一致的链路

1. `sessions.create` 的普通桌面请求只发送 `agentId` 和可选 `label`、`parentSessionKey`、`fork`，
   均属于官方 `SessionsCreateParamsSchema`。
2. OpenClaw 在未提供 key 时生成新的 dashboard key；无 `message`、`task`、`attachments` 且非
   `fork` 时，不会创建初始 turn。JunQi 因此把 Gateway 已确认的新 transcript 投影为
   `activeLeafEntryId: null`，并将该值作为首发 `chat.send` 的官方 CAS 参数。
3. Gateway 的 `chat.send` 会在会话生命周期锁内重新读取 canonical entry，校验
   `expectedLeafEntryId`，并在 `sessionId` 已轮换时拒绝旧发送。JunQi 对官方
   `active-leaf-changed` 错误执行后台 `chat.history` 刷新，没有合成 transcript 消息或 leaf。
4. `SessionRowSchema` 明确允许 `sessionId` 和 `activeLeafEntryId` 缺省，且官方行投影通常会从持久化
   entry 返回 `sessionId`。JunQi 从官方 key 的 `agent:<agentId>:` 段投影 `agentId`，没有向 Gateway
   添加未定义字段。

### 发现与分级

#### BUG-01 中等：稀疏会话行下的本地身份保留缺少官方终态收敛

**位置**：`src/utils/confirmedEmptyTranscript.ts:26-50`

当同 key 的 `sessions.list` 行同时省略 `sessionId`、`agentId` 和 leaf 时，JunQi 会无限期保留创建
确认的旧 `sessionId` 与空 leaf。该保留可以避免首屏历史门禁回归，但“缺省不是身份轮换”不是
OpenClaw 协议承诺；若期间 Gateway 已执行 reset，首发会被 Gateway 以 session identity changed
拒绝，而 `useMessageSend` 只对结构化 `active-leaf-changed` 触发历史刷新，可能留下失败消息和过期
本地投影。

**处理结果**：已确认空会话的首发被 Gateway 拒绝时，JunQi 只发起一次后台官方 `chat.history`
恢复，以重新取得 session identity 与 leaf；不解析错误文案、不自动重发，也不把恢复结果写成合成
transcript。

#### BUG-02 中等：创建结果未按返回 key 核验 Agent 身份

**位置**：`src/utils/sessionCreate.ts:45-53`、`src/services/gateway/OpenClawSessionLifecycleClient.ts:47-73`

`parseOpenClawCreatedSession` 只校验 `ok`、key、sessionId 和 entry.sessionId；随后
`projectCreatedNativeSession` 直接使用请求中的 `input.agentId`。官方 Gateway 当前会拒绝 key 与
agentId 不一致的请求，因此正常链路不会触发，但客户端仍把一个未核验的请求字段写入会话身份，且
现有测试用“请求 architect、返回 agent:main key”作为有效 fixture，掩盖了这一边界。

**处理结果**：已从返回 key 投影 Agent 身份，并在创建客户端校验请求 Agent 与返回 key 不一致时拒绝
提交；测试 fixture 已改为符合官方返回契约。

#### BUG-03 低至中等：本地合并并发新建请求改变了官方一次调用一次新会话语义

**位置**：`src/utils/sessionCreate.ts:84-85、112-135`

OpenClaw 对未提供 key 的 `sessions.create` 使用新的 UUID dashboard key。JunQi 以
`agentId + label + parentSessionKey + fork` 为本地 inflight key，将相同参数的并发调用合并为一个
Gateway 请求。该行为不是 OpenClaw 的幂等协议，双击或两个独立入口的同参数新建会话会少创建一个
官方会话。

**处理结果**：已删除参数级 inflight 合并。每次 `createNativeSession` 调用都保持一次原生
`sessions.create`；具体 UI 的进行中状态仍负责阻止重复点击。

#### BUG-04 中等：大小写不同的 Agent 请求会被错误拒绝

**位置**：`src/services/gateway/OpenClawSessionLifecycleClient.ts`

OpenClaw 官方 `normalizeAgentId` 会把合法 Agent 标识规范化为小写，并在含非法字符时生成安全形式。
Gateway 返回的 session key 使用该规范形式。JunQi 旧校验直接比较原始请求和 key 中的 Agent 段，导致
`MAIN` 这类有效请求被误判为跨 Agent 响应。

**处理结果**：创建客户端使用与官方 `normalizeAgentId` 相同的规范化规则比较请求与返回身份；本地
会话继续只记录 Gateway key 已确认的 Agent 段。

### 审计验证

- [x] OpenClaw 协议 schema、Gateway 创建服务、会话行投影、首发 CAS 和官方控制台调用已交叉核对。
- [x] JunQi 全套前端与脚本测试通过。
- [x] `pnpm lint` 与 `pnpm build` 通过。
- [x] `git diff --check` 与修改文件 Emoji 扫描通过。
- [x] BUG-01 至 BUG-04 已完成代码修复，并建立对应 plan/spec。
- [ ] macOS、Windows、Ubuntu、CentOS 的真实 Gateway 桌面操作仍需分别验收。

## 2026-08-08 Windows 新建会话竞态复核

Windows 验收再次出现新建会话进入“正在加载历史记录”的问题。全链复核确认，历史读取分流函数本身
仍会正确跳过已确认空 transcript；丢失发生在 `sessions.create` 确认和本地提交之间。

OpenClaw 会先持久化新会话条目，再返回 `sessions.create`。在返回到达 JunQi 本地提交前，Gateway
会话列表刷新可能已经把相同 key 的稀疏行写入 `chatStore.sessions`。此时 `addNativeSession` 发现 key
已存在，只切换活动页签，没有把创建响应中权威的 `sessionId`、`agentId` 和
`activeLeafEntryId: null` 合并回该行。随后 `ChatView` 只能把 leaf 视为未知并执行 `chat.history`。
Windows 的事件和 RPC 时序更容易暴露该竞态，但问题属于跨平台状态合并，不是 Windows 专属协议。

目标修复是在 `addNativeSession` 的单一提交边界始终把 `sessions.create` 确认结果合并到同 key 行；
列表中已有的其他元数据继续保留，创建确认字段优先。该规则只处理同一次官方创建的结果，不根据空
消息数组推断新会话，也不跳过普通历史会话的 `chat.history`。

### 复核结果

- 已增加失败回归，修复前确认 `sessionId` 丢失并触发未知 transcript 分支，修复后创建确认完整合并。
- 新会话在列表先到竞态下仍保持 `activeLeafEntryId: null`，历史加载判据返回 false。
- 已通过 70 项新建会话与历史分流聚焦测试、`pnpm lint`、完整 `pnpm test` 和 `pnpm build`。
- Windows 真机新建会话、输入框首发和重启后的完整桌面链路仍待安装包验收。
