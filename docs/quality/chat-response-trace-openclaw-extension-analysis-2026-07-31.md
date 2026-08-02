# 会话执行追溯的 OpenClaw 能力拓展分析

日期：2026-07-31

状态注记（2026-08-03）：EXT-01 已按官方当前主线的 `audit.activity.list` 与兼容 `audit.list` 落地，EXT-06 的上游 compaction block 已恢复到结构化追溯，EXT-04 已按当前官方 `SessionOperationEventSchema` 接入本地事件投影；具体边界见 [OpenClaw 审计账本与 JunQi 追溯对齐](openclaw-audit-ledger-alignment-2026-08-03.md)、[OpenClaw 压缩事件追溯对齐](openclaw-compaction-trace-alignment-2026-08-03.md) 和 [OpenClaw 会话操作事件对齐](openclaw-session-operation-alignment-2026-08-03.md)。本文保留为 2026-07-31 的历史分析，不把当时的“未接入”结论当作当前实现状态。

## 依据

本文是 2026-07-31 的历史审计，只记录当时本机安装版本的复现证据；当前实现契约以 OpenClaw 官方文档、schema、handler 和协议定义为准，当前复核见文首链接。

- 安装版本：`OpenClaw 2026.7.1-2 (0790d9f)`，路径 `~/.npm-global/lib/node_modules/openclaw`
- 契约来源：`docs/gateway/protocol.md`、`docs/gateway/operator-scopes.md`、`docs/cli/audit.md`、`docs/concepts/usage-tracking.md`、`docs/concepts/compaction.md`、`docs/gateway/configuration-reference.md`
- JunQi 侧基线：`daxia@de2a5b6`（`daxia`、`main`、`origin/main` 三者同点）
- 本文初稿写于 `dc25f72`。此后追溯链路被 `d1fd619` 等提交改动（新增来源记录下钻面板与其展示模块），全部结论已在 `de2a5b6` 上重新核验，下文数字与行号均为重新测量的结果
- 既有记录：`docs/quality/chat-response-trace-and-human-review-2026-07-31.md`、`specs/quality/2026-07-31-chat-response-trace-and-human-review.md`、`docs/quality/chat-execution-plan-protocol-audit-2026-07-30.md`

本文为只读分析，未修改任何实现。

## 当前实现盘点

追溯链路的生产代码共 698 行，分布在 6 个文件：

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `src/components/Chat/ChatResponseTraceNodeCard.tsx` | 200 | 单节点渲染 |
| `src/components/Chat/chatResponseTrace.ts` | 156 | 领域投影：`ResponseGroup` 到 `ChatResponseTrace` |
| `src/components/Chat/ChatResponseTracePanel.tsx` | 143 | 侧边面板外壳 |
| `src/components/Chat/ChatTraceSourceMessagePanel.tsx` | 134 | 来源记录下钻 |
| `src/components/Chat/chatTraceSourceMessagePresentation.ts` | 45 | 来源记录展示映射 |
| `src/components/Chat/chatResponseTracePresentation.ts` | 20 | 展示层映射 |

入口为 `src/components/Chat/ChatView.tsx` 与 `src/pages/QuickChatPage.tsx`，两者共用同一投影与面板。

当前追溯的数据完全来自前端已有的 `ResponseGroup`，即 Gateway transcript 与 `session.message`、`session.tool` 事件在前端聚合后的结果。`ChatResponseTrace.authority` 只有两个取值：`openclaw-run`（有 `runId`）与 `gateway-transcript`（无 `runId`）。

现有实现的自我约束是清醒的：`specs/quality/2026-07-31-chat-response-trace-and-human-review.md` 明确不把本地派生的响应组 ID 当作 OpenClaw 原生 Trace ID，不把 Chat transcript 描述为正式审批账本。这些约束在当时的数据来源下是正确的。**本文的核心结论是：OpenClaw 2026.7.1 已经提供了可以解除其中大部分约束的官方能力，JunQi 尚未接入。**

## 拓展项

按「价值 / 接入成本」排序。每项都标注官方依据、当前行为、可拓展行为与必须保留的边界。

### EXT-01 · 接入 `audit.list`，给追溯一个真正的权威来源

优先级：高。这是本次分析中价值最高、成本最低的一项。

**官方依据**：`docs/gateway/protocol.md:531-556`、`docs/cli/audit.md`

OpenClaw 内置一个 metadata-only 的审计账本，通过 `audit.list` 暴露：

- 过滤参数：精确 `agentId`、`sessionKey`、`runId`；`kind` 为 `agent_run` 或 `tool_action`；`status`；`after` / `before` 毫秒边界；`limit` 1 到 500；`cursor` 分页
- 返回：`{ events: AuditEvent[], nextCursor?: string }`，newest-first
- 每条事件包含：**稳定 event id、单调 ledger sequence、source event sequence、时间戳、actor、agent/session/run 归属、action、status、规范化 error code**；工具事件另含 `toolCallId` 与工具名
- 权限：`operator.read`

**当前行为**：JunQi 从未调用 `audit.list`（全仓检索 0 处）。追溯节点 ID 直接复用前端 block ID，`ChatResponseTrace.id` 复用本地 `group.id`。

**可拓展行为**：

- 追溯面板的技术详情区按 `runId` 查询 `audit.list`，展示 OpenClaw 侧的稳定 event id 与 ledger sequence，作为真正的原生追溯标识。现有 spec 中「不把本地派生 ID 描述为原生 Trace ID」的约束因此可以在有审计记录时解除，且不需要伪造任何标识。
- 用官方 `sourceSequence` 与 `toolCallId` 校验前端聚合的节点顺序。目前顺序完全依赖前端聚合，没有独立参照物。
- `actor` 字段可以回答「这次运行是谁发起的」，当前追溯完全没有这个维度。

**必须保留的边界**：

- `redaction` 恒为 `metadata_only`，账本不存 prompt、消息、工具参数、工具结果、命令输出和原始错误文本。审计不能替代 transcript，只能作为交叉校验层，UI 不得暗示它包含内容。
- 保留期 30 天，账本上限 10 万行，过期行会在 Gateway 启动、每小时维护和后续写入时删除。历史响应查不到审计记录是正常状态，必须显式区分「已过期」和「未记录」。
- `audit.enabled` 可被关闭（`docs/gateway/configuration-reference.md:1080`）。关闭后 `audit.list` 仍返回此前写入的记录。UI 需要处理「审计关闭」这一合法状态，不能显示为错误。
- `operator.read` 已在 JunQi 日常连接的 `DAILY_OPERATOR_SCOPES` 中（`src/services/gateway/Connection.ts:39-42`），**这一项不需要任何 scope 升级**。

### EXT-02 · 对齐状态词汇，补齐 `blocked` 与 `timed_out`

优先级：高。成本极低，但直接影响用户能否正确理解失败原因。

**官方依据**：`docs/gateway/protocol.md:539-541`、`docs/cli/audit.md` 过滤器章节

OpenClaw 审计状态为 7 值：`started`、`succeeded`、`failed`、`cancelled`、`timed_out`、`blocked`、`unknown`。

**当前行为**：`src/types/ResponseGroup.ts:9` 定义 `status: 'streaming' | 'final' | 'error' | 'aborted'`，共 4 值。

**差距**：

| OpenClaw | JunQi 现状 |
| --- | --- |
| `blocked` | 无对应值，会被压成 `error` |
| `timed_out` | 无对应值，会被压成 `error` |
| `cancelled` | 近似对应 `aborted` |
| `unknown` | 无对应值 |

`blocked` 的丢失影响最大：策略或审批拦截与模型自身出错是完全不同的因果，用户看到的都是「错误」，无法判断该去调审批策略还是重试。`timed_out` 同理，超时与失败的处置方式不同。

**可拓展行为**：扩展状态词汇并在追溯节点上区分展示。若前端事件流本身不携带这些状态，可由 EXT-01 的审计记录补足。

### EXT-03 · 接入 exec / plugin approval，把「transcript-only」升级为可确认的正式审批

优先级：高。这是现有 spec 明确留下的缺口，而 OpenClaw 已提供完整契约。

**官方依据**：`docs/gateway/protocol.md:485-489`（RPC 家族）、`:521`（事件）、`:692-706`（exec approvals 语义）、`docs/gateway/operator-scopes.md:38`（scope）

OpenClaw 提供两套并行的审批协议：

- exec：`exec.approval.request`、`exec.approval.get`、`exec.approval.list`、`exec.approval.resolve`、`exec.approval.waitDecision`；事件 `exec.approval.requested` / `exec.approval.resolved`
- plugin：`plugin.approval.request`、`plugin.approval.list`、`plugin.approval.waitDecision`、`plugin.approval.resolve`；事件 `plugin.approval.requested` / `plugin.approval.resolved`

`exec.approval.list` 支持 pending 查询与重放，`waitDecision` 返回最终决定或超时 `null`。解析需要 `operator.approvals` scope。协议还规定：审批通过后转发的 `node.invoke system.run` 必须复用审批时的 canonical `systemRunPlan`，若调用方在准备与最终转发之间篡改 `command`、`rawCommand`、`cwd`、`agentId` 或 `sessionKey`，Gateway 拒绝执行。

**当前行为**：JunQi 全仓没有任何 `exec.approval` 或 `plugin.approval` 调用。`ChatResponseTrace.review.recording` 硬编码为 `'transcript-only'`（`chatResponseTrace.ts:150`），`formalReviewId` 仅来自 Collaboration 插件的 decision block。`GatewayOperatorScope` 类型已声明 `'operator.approvals'`（`Connection.ts:36`），但 `DAILY_OPERATOR_SCOPES` 不包含它，日常连接拿不到该权限。

**可拓展行为**：

- 追溯面板订阅 `exec.approval.requested` / `resolved`，把审批请求与决议作为一等追溯节点，携带真实的 decision 与 actor。
- 对 exec / plugin 审批，`review.recording` 可以从 `transcript-only` 升级为有据可查的正式记录。spec 中「无法确认人工选择已被正式记录时，不显示已审核」的失败关闭条件仍然成立，只是对这一类审批而言，**确认现在是可能的**。
- `exec.approval.list` 可用于面板重新打开时重放 pending 审批，避免错过事件窗口。

**必须保留的边界**：

- 这与 Chat 内的 `inline-buttons` / `decision` block 是**两套不同机制**。inline buttons 仍然是 transcript-only，不能因为接入了 exec approval 就把二者混为一谈。现有的区分是正确的，拓展只应新增一类节点，不应改写既有语义。
- 解析审批需要 `operator.approvals`，属于权限提升。JunQi 已有 admin scope 升级机制（见 `docs/installation/openclaw-windows-wizard-audit.md` 中 BUG-WIZ-01 的处理），应复用而不是把该 scope 加进日常连接。**只读展示审批节点与执行解析操作应分开授权**：展示走现有 scope，解析才升级。

### EXT-04 · 订阅 `session.operation`

优先级：中。当前是一个完整的官方事件族被遗漏。

**官方依据**：`docs/gateway/protocol.md:508-509`

> `session.message`、`session.operation`、`session.tool`：transcript、**in-flight session operation**、event-stream updates for a subscribed session。

**审计时行为**：JunQi 只处理 `session.message` 与 `session.tool`，全仓检索 `session.operation` 命中 0 处。当前行为已由新的 [会话操作事件对齐记录](openclaw-session-operation-alignment-2026-08-03.md) 更新。

**可拓展行为**：in-flight operation 是「当前正在做什么」的权威来源。目前追溯对进行中状态只能从 tool 事件的 `running` 状态反推，两者的语义粒度并不相同。接入后，追溯面板在响应进行中可以展示官方口径的当前操作，而不是前端推断。

**历史待验证项已关闭**：当时随包文档没有完整 payload；2026-08-03 已从官方当前 [SessionOperationEventSchema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)、compact handler 和广播源码确认字段并完成客户端 decoder。真实 Gateway 联机和跨平台真机验证仍待完成。

### EXT-05 · 每响应的模型与用量

优先级：中。

**官方依据**：`docs/concepts/usage-tracking.md:18`、`:99-104`

- `/usage off|tokens|full` 控制**每响应**的用量页脚，按会话记忆
- `/usage tokens` 渲染 `Usage: X in / Y out`，可含缓存与估算成本后缀
- `/usage full` 展示 model、reasoning、fast/slow、context window 与 cost（字段可用时）
- 协议侧 `sessions.usage`、`sessions.usage.timeseries`、`sessions.usage.logs` 提供会话级用量（`protocol.md:352-354`）

**当前行为**：追溯面板对 token、cost、model 三个关键词命中 0 处。JunQi 已经在 `src/stores/gatewayDataStore.ts`、`src/utils/activitySessions.ts`、`src/pages/LogsViewer.tsx`、`src/services/gateway/index.ts` 调用了 `sessions.usage` 系列，但这些数据没有进入追溯。

**可拓展行为**：追溯是「这次响应到底发生了什么」的视图，「用了哪个模型、消耗多少、花了多少钱」属于该问题的核心部分。已有的 usage 数据接入追溯的边际成本很低。

**必须保留的边界**：

- 官方明确成本是 **estimated**，且仅对 API key 模型可用（`usage-tracking.md:17`）。UI 必须标注为估算，不得呈现为账单事实。
- `/usage full` 的字段是「可用时才显示」，缺失是常态而非异常。
- 会话级用量与响应级用量粒度不同，不能把会话汇总直接标注为单次响应的消耗。

### EXT-06 · 保留 compaction 作为追溯节点

优先级：中。这是当前实现的一处主动信息丢弃。

**官方依据**：`docs/concepts/compaction.md:36`、`:126-133`

压缩前 OpenClaw 会提醒 agent 把要点存入 memory 以防上下文丢失。`notifyUser` 为 true 时，压缩开始与完成都会显示状态消息，**预压缩 memory flush 耗尽但回复仍继续时会给出 degraded 通知**。

**当前行为**：`src/components/Chat/chatResponseTrace.ts:122-124` 对 `system-note` 与 `compaction` 两类 block 直接返回空数组，它们不会出现在追溯中。

**可拓展行为**：压缩是真实的执行事件，会改变模型可见的上下文，是解释「为什么后面的回答忘了前面的内容」的关键线索。追溯应保留 compaction 节点，尤其是 degraded 那一类通知。这与主消息流是否显示压缩提示是两个独立决定——主流可以安静，追溯不该失忆。

### EXT-07 · 跨响应与跨会话的追溯查询

优先级：中低。依赖 EXT-01 落地。

**官方依据**：`docs/cli/audit.md` 过滤器与分页章节

`audit.list` 支持按 `agentId` / `sessionKey` / `runId` / `kind` / `status` / 时间区间过滤，`limit` 最大 500，`cursor` 分页，newest-first。

**当前行为**：追溯的作用域是单个 `ResponseGroup`，无法回答跨响应的问题。

**可拓展行为**：「这个 agent 今天失败了几次」「这个会话里哪些工具调用被 blocked」这类问题，官方账本已经能直接回答。可作为追溯面板之上的一个运维视图，或并入现有 `LogsViewer`。

**边界**：仍受 30 天保留期与 metadata-only 限制。

### EXT-08 · 覆盖 cron 与 task 发起的运行

优先级：低。

**官方依据**：`docs/gateway/protocol.md:497-499`（`cron.run` 返回 `runId`，`cron.runs` 支持 `runId` 过滤）、`:562-570`（`tasks.list` / `tasks.get` / `tasks.cancel`，状态 `queued` / `running` / `completed` / `failed` / `cancelled` / `timed_out`）

**当前行为**：追溯只覆盖交互式 chat 响应。`tasks.get` 在 JunQi 中仅出现在 `src/services/collaboration/sessionLifecycle.test.ts` 的 mock 里，`tasks.list` 与 `cron.runs` 未使用。

**可拓展行为**：定时任务与后台任务同样产生 `runId`，同样可以用 `audit.list` 追溯。接入后追溯不再局限于用户主动发起的对话。这与既有的 BUG-SESS-01（cron 运行泄漏到用户会话列表，见 `docs/quality/session-origin-aggregation-audit.md`）是同一问题域的两面：那边要求把 cron 运行从会话列表分离，这边要求给它一个正确的归属视图。

## 不建议做的

- **不要把工具调用归属到计划步骤**。`docs/quality/chat-execution-plan-protocol-audit-2026-07-30.md` 已核实 `update_plan` 不提供稳定 `planId`、Step ID 或调用与步骤的关联字段。审计账本同样没有这层关联。现有 spec 的这条禁令应当保留。
- **不要用审计账本重建 transcript**。`redaction` 恒为 `metadata_only` 是设计约束而非缺陷。
- **不要把 inline buttons 的选择改写成正式审批**。EXT-03 只对 exec / plugin approval 成立。
- **不要为了追溯给日常连接加 `operator.approvals`**。只读展示与解析操作分层授权。

## 建议顺序

1. EXT-01 与 EXT-02 一起做。二者共用 `audit.list` 的接入，且不需要 scope 变更，是解除现有 spec 自我约束的最短路径。
2. EXT-06 单独做，改动最小，只是停止丢弃已有数据。
3. EXT-05 接入已有的 usage 数据。
4. EXT-04 已按官方当前 schema 接入；真实 Gateway 联机验证单独记录在 [会话操作事件对齐记录](openclaw-session-operation-alignment-2026-08-03.md)。
5. EXT-03 涉及权限提升与安全语义，独立立项，需要 spec 与 plan 三层记录。
6. EXT-07 与 EXT-08 依赖 EXT-01。

## 未验证边界

- 本文全部结论来自 2026-07-31 的随包文档静态阅读。未连接真实 Gateway 调用 `audit.list`、`exec.approval.list` 或订阅 `session.operation`，因此当时未取得响应体样本。
- 2026-08-03 已从官方当前主线源码核对 `SessionOperationEventSchema`、`sessions.compact` handler 与 `emitSessionOperation`；本条只保留为历史限制，不代表当前实现契约。
- 未验证 `audit.enabled` 在当前本机配置中的实际取值，也未验证本机账本中是否已有可查询记录。
- 未评估接入 `audit.list` 后的性能影响，包括每次打开追溯面板发起查询的频率与缓存策略。
- 状态词汇扩展会影响 `ResponseGroup` 的既有消费方，本文未清点全部调用点，实际改动前需要完整核对。
- 本文未做任何实现改动，因此不涉及测试与构建验证。
