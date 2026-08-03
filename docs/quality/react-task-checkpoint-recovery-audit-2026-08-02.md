# ReAct 任务中断与恢复审计

日期：2026-08-02

## 结论

JunQi 现在为普通 Chat、Quick Chat 和 Jarvis 语音路径持久化本地 Task checkpoint，并把每个 Run 绑定到经过验证的 OpenClaw runtime、session key 和 session identity。Stop 先记录 cancel intent，再调用 OpenClaw 控制面；工具调用缺少权威结果时保留 `verification_required` 和本地 reconciliation node，不向 Gateway transcript 写入猜测结果。冷启动或 history 核验后，桌面只显示核验入口，不自动恢复或重试。

这满足“一个 Task 一个 Session，Stop 停输出但保留 Task 记忆”的客户端侧持久化边界，但不声称 JunQi 获得了 OpenClaw 未提供的工具幂等、自动恢复或后台 Task 关联能力。

不能由 JunQi 向 Gateway transcript 写入猜测性的 Tool Result。当前安装的 OpenClaw `2026.7.1-2` 对中断 assistant turn 采用回滚式闭合：重放时丢弃中断 turn 的未配对工具链；仅当当前模型的传输策略允许时，OpenClaw 才在发送给模型的重放载荷中合成缺失工具结果。JunQi 必须保存中断与核验状态、重新读取权威 transcript，而不是复制这一修复到客户端或伪造工具完成结果。

LiveKit Agents 可作为语音会话监督、打断语义、回合检测、测试与可观测性的参考；它是服务端 WebRTC Agent 框架，不应引入为 JunQi 的第二套任务、会话、工具或媒体运行时。OpenClaw 继续是 Chat、Agent、工具调用和持久 transcript 的唯一权威。

## 依据

- 当前复现环境：`pnpm-lock.yaml` 锁定 `openclaw@2026.7.1-2`；该版本只界定本次运行验证范围，不作为能力开关或字段契约。
- `src/services/gateway/index.ts` 以 `chat.send` 的 `idempotencyKey` 作为 Chat Run 身份；`abortChat` 按已知 `runId` 调用官方 `sessions.abort`。能力依据是 OpenClaw 官方文档、schema 和 handler。
- `src/services/gateway/ChatHandler.ts` 只在 Gateway 确认中断后结算该 Run，并触发 `refreshHistory`；`src/App.tsx` 读取持久 transcript 进行重协调。
- 安装包 `docs/web/control-ui.md` 说明中断会保留可展示的部分输出，并将其及中断元数据写入 transcript。
- 安装包 `dist/session-transcript-repair-*.js` 的 `repairToolUseResultPairing` 对 `stopReason: "aborted" | "error"` 不合成结果；`dist/openai-transport-stream-*.js` 仅在模型策略允许合成结果时，针对可重放载荷补齐。
- `packages/junqi-collab/src/service.ts` 已有持久 `work_items`、`attempts`、`commands`、`openclaw_run_id`、取消命令、未知结果重协调、revision 与 idempotency key。`src/services/collaboration/workflowGraph.ts` 只绘制服务端权威工作项的只读图。
- `CONTEXT.md` 明确 Graph Projection 是只读派生视图，不能成为 orchestration state。
- [LiveKit Agents 仓库](https://github.com/livekit/agents) 的 README 定义 AgentSession、AgentServer、任务分发、回合检测和测试；其运行方式为服务端实时参与者，不是本机桌面媒体宿主。

## 已满足行为

1. Chat 发送拥有 `idempotencyKey`，重复提交不会直接创建第二个同身份的 Chat Run。
2. Stop 使用独立控制面 RPC，不等待长时间 `chat.send` 请求完成。
3. 已知 Run 中断会以 `runId` 精确结算本地投影，显示中断终态并刷新 Gateway transcript。
4. Jarvis 在接收下一段语音前会先停止本地语音输出与当前 Chat Run，具备基础打断路径。
5. 协作插件已证明数据库 revision、取消命令、未知结果与依赖解锁可以形成可靠的任务编排模式。

## 发现

### RTCR-01 高风险：通用 Chat/Jarvis 没有持久 Task Checkpoint

`OpenClawChatRunProjection`、`OpenClawPendingChatSendRegistry` 和 `SessionRunFence` 都是 renderer 内存投影。应用冷启动、模型切换或连接丢失后，JunQi 只能从 Gateway history 和 sessions list 重建可见状态，不能恢复本次任务的计划节点、工具状态、恢复策略或上次一致 checkpoint。

影响：Stop 后下一次请求能继续同一 OpenClaw session 的上下文，但不能证明它恢复的是同一 Task 的一致 ReAct 状态。

**2026-08-03 状态**：已通过 `src/task-execution/`、现有 Tauri `workbench_session` 原子存储和 generation CAS 修复客户端持久化。恢复只读取与当前 runtime/session identity 精确匹配的 checkpoint；无匹配或身份发生轮换时不合并任务。

### RTCR-02 高风险：工具状态没有取消和核验状态

`ToolExecutionStatus` 只有 `running`、`done` 和 `error`。若中断发生在工具调用已产生、结果未可见时，界面无法区分“已取消且确认未执行”“远端执行不确定，需核验”和“已由 OpenClaw transcript 回滚”。自动重试会有重复副作用风险。

**2026-08-03 状态**：工具节点已支持 `cancelled`、`verification_required` 和独立 `tool_reconciliation` 节点。上游未返回结果时只进入人工核验，不创建 synthetic Tool Result，也不自动重试。

### RTCR-03 高风险：Stop 不持久记录恢复决策

现有 Stop 清空本地队列并调用控制面。尽管 ChatHandler 会在确认后刷新历史，但没有保存停止请求、目标 runId、Gateway 身份、转录读回结果、未结工具调用清单、核验结论或恢复入口。因此无法安全地在冷启动后继续、切换模型或展示残余风险。

**2026-08-03 状态**：Stop intent、Run terminal reason、history observation、session identity 和模型身份已持久化；Chat/Quick Chat 页面显示只读恢复提示并把“核验”动作接回官方 `chat.history`。客户端没有自动 resume decision，因为 OpenClaw 当前契约没有提供可验证的通用恢复/副作用查询接口。

### RTCR-04 中风险：协作 DAG 不能直接替代单会话 ReAct 图

协作插件的 Work Item DAG 是 plugin 服务器权威域，用于多智能体 Workflow Run。普通 Chat Session 没有对应的持久 Run，且协作图按术语只能投影，不能被 UI 直接写入。复用其数据库模式与状态机原则可行，直接把通用 Chat 变成协作 Workflow Run 会改变既有授权、Origin 与审批边界。

### RTCR-05 中风险：LiveKit 不应成为桌面依赖

LiveKit 的 AgentSession、Server、WebRTC 和独立 STT/LLM/TTS 工具链会与 JunQi 的 Tauri 原生麦克风、OpenClaw Gateway、selected runtime 和凭据边界形成双重权威。可借鉴其 barge-in、turn lifecycle、测试和指标设计，但不接入其服务端或 WebRTC 运行时。

## 目标架构

新增 JunQi 自有的 `TaskExecution` 持久领域，但不接管 OpenClaw 工具协议。

- 一个可恢复 Task 绑定一个 OpenClaw `sessionKey` 和 Gateway runtime identity；Task 的每次 Run 绑定唯一 `runId` 与 Chat `idempotencyKey`。
- Task Graph 是持久状态机，不是 UI 图。节点包括 user turn、model turn、tool invocation 和 tool reconciliation；边可在 OpenClaw 工具事件和权威 history 读取后追加。恢复提示是只读投影，不是新的 OpenClaw 状态机。
- Checkpoint 只保存恢复所需的元数据、节点 revision、OpenClaw 引用、状态摘要和可验证指纹；不复制 token、原始音频、密钥或猜测性的工具结果。
- Stop 顺序固定为：持久写入 stop intent 与 checkpoint，停止本地语音输出，调用官方 `sessions.abort`，读取权威 transcript，给未结工具节点标记为 cancelled、rolled_back 或 verification_required，最后提交 checkpoint。
- Resume 只从匹配的 Gateway identity、`sessionKey` 和 session identity 加载 checkpoint，并先读取 OpenClaw history。session identity 轮换会创建新的 Task checkpoint；模型身份按 Run 记录，未验证的工具节点不能被带入新模型上下文作为完成事实。
- 副作用工具不能由 JunQi 自动重试。恢复前必须由 OpenClaw 可验证的结果、工具幂等键或显式人工决策关闭不确定性。
- 并发只允许图上无依赖且资源键不冲突的节点；同一 OpenClaw session 保持一个活动 Chat Run，跨 Session 的任务并发遵守独立 Gateway identity、运行时和资源锁。

## LiveKit 可借鉴范围

| LiveKit 概念 | JunQi 适配 | 不采用部分 |
| --- | --- | --- |
| AgentSession 生命周期 | 语音回合与 Task Run 的监督状态 | 独立 Agent/LLM 会话权威 |
| Barge-in 与回合检测 | 唤醒、说话、播放、打断的明确转换和延迟指标 | WebRTC 媒体链路 |
| Job 分发 | 借鉴协作插件中独立 Work Item 的调度约束 | 引入 AgentServer 或云调度 |
| 测试框架 | 中断、工具半截、冷启动、模型切换的场景测试 | 依赖 LiveKit 测试运行时 |

## 未验证边界

- 尚未在真实 Gateway 上复现“工具调用发出后进程中断”的完整持久 transcript 形态。
- OpenClaw 按不同模型策略生成 synthetic tool result 的兼容性仍须以目标模型的真实请求验证。
- 真实副作用工具的幂等键、查询能力和补偿能力由各工具插件决定，不能由 JunQi 假定。
- Windows、CentOS、Ubuntu 的实际麦克风、唤醒模型、后台常驻与 Gateway 连通性仍需目标系统验收。

## 2026-08-02 实施记录

已完成第一段 P0 实现：

1. `src/task-execution/` 定义 Task、Run、Node、checkpoint revision、运行时绑定和跨 WebView generation 冲突合并。
2. checkpoint 使用现有 Tauri `workbench_session` 原子写、备份与 generation CAS，存储在应用数据目录；不写入 OpenClaw transcript、前端持久存储、原始音频、密钥或工具原始载荷。
3. `ChatSendCoordinator` 在 `chat.send` 前写入 Run checkpoint；Quick Chat 和 Jarvis 语音写入各自来源。
4. `gateway.abortChat` 在 `sessions.abort` 前写入 cancel intent；只有 Gateway 返回精确 `abortedRunId` 时由 `App.tsx` 结算 Run，否则保留 reconciliation。
5. Gateway tool lifecycle 事件被记录为 Task Node。Abort 时仍未得到结果的工具节点与工具卡均转为 `verification_required`，不自动重试或伪造结果。

6. `chat.history` 的 `sessionId`、活动 Run 信息被写入匹配 Task 的核验 checkpoint。此记录只确认 Gateway 已被读取，不把无活动 Run 推断为工具成功、回滚或可重试。
7. 跨 WebView 的 checkpoint 冲突按 Run 和 Node 合并；相同实体按更新时间和风险更高的状态取值，独立工具节点不会因整 Task 覆盖丢失。
8. Gateway adapter 已以严格解码形式提供原生 `tasks.list`、`tasks.get` 与 `tasks.cancel`。该账本用于背景任务，不替代 Chat transcript；取消走 `operator.write` 的 privileged lane。

9. 已按 OpenClaw 官方 `sessions.steer` schema 与 Gateway handler 接入语音抢话路径。请求只发送官方支持的 `key`、`message`、可选附件和 `idempotencyKey`；JunQi 先持久化旧 Run 的 cancel intent 与新 Run 的发送 intent，只有响应中的 `interruptedActiveRun: true` 才结算旧 Run。2026-08-03 起普通文本活动 Run 的 queue mode 交由 Gateway；JunQi 本地可见队列只保留显式选择和会话 mutation gate，详见 [OpenClaw 原生会话队列对齐](openclaw-native-session-queue-alignment-2026-08-03.md)。
10. Gateway transport 支持 `AbortSignal`，其语义仅是停止 renderer 对 RPC 的等待并清理本地 pending request，不改变远端执行状态；远端中断依赖 `sessions.steer` 或 `sessions.abort` 的官方确认。
11. checkpoint schema 已修复可选工具字段校验：`user_turn`、`model_turn` 不再因缺少 `effectKey` 被拒绝；旧 checkpoint 的历史、运行时和恢复字段会在读入时规范化。`effectKey` 仅是 JunQi 本地工具关联标识，不是 OpenClaw 工具幂等键。
12. Task checkpoint 现在持久化最小图边：发送意图的 `user_turn -> model_turn`、OpenClaw tool event 的 `model_turn -> tool_invocation`，以及 steer 的 `supersedes` 关系。边携带证据来源，只表达已观察到的顺序或本地意图；不同工具节点没有被客户端强行串行化。

13. 冷启动后的 Chat 与 Quick Chat 显示 `verification_required`、未核验工具数量和官方 history 核验入口；按钮不会自动恢复、重试或改变本地状态。
14. 每个 Run 记录发送时可观察到的模型身份；session identity 轮换生成新的 Task checkpoint。无 sessionId 的 Stream 结束、Tool event 和 Stop 回调只在同一 attested runtime 下存在唯一 checkpoint 时解析到该任务，候选不唯一则失败关闭。
15. 本地队列排空路径也会先通过 Task checkpoint 协调器再发送 OpenClaw `chat.send`；无活动 Run 时创建新的 Run，已有活动 Run 时复用其边界，不再因排空输入创建第二个活动 Run。Chat、Quick Chat 和 Jarvis 不再有绕过 checkpoint 的发送入口。

16. 2026-08-03 的 Stop 对齐补充保证：Task checkpoint 的 Stop intent 写入失败会阻止远端
    `sessions.abort`，不会记录错误后继续中止 Run；普通 Composer、Jarvis 与 Quick Chat 的
    Stop 不再清除 JunQi 本地待发送队列。Gateway 的 run-scoped abort 仍默认省略
    `clearQueued`，显式 queue 清理、Session reset/delete 和 Quick Chat 窗口销毁保持独立语义。

仍未完成且不能描述为已完成：真实 Gateway 中工具进程中断的复现、真实副作用工具的幂等/查询/补偿策略、将 `tasks.*` 账本自动关联到 Chat Task、自动恢复或自动重试、以及 macOS/Windows/CentOS/Ubuntu 的真机麦克风、后台常驻和发布验收。
