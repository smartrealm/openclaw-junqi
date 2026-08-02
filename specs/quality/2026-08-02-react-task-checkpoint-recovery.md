# ReAct 任务检查点与恢复规格

日期：2026-08-02

## 目标

为 JunQi 的普通 Chat 和 Jarvis 语音触发任务提供持久执行图，使 Stop 只停止当前输出而不丢失 Task 记忆；恢复前必须对 OpenClaw 权威 transcript 和工具副作用风险完成核验。

## 行为要求

1. 一个 Task 只能绑定一个 `sessionKey`、一个经过验证的 Gateway runtime identity 和一个当前 OpenClaw session identity。
2. 每个 Task Run 记录唯一 `runId`、发送幂等键、模型身份、开始和终止原因。
3. Task Graph 与 Graph Projection 分离。Graph 是持久状态机；界面只读投影，不能直接改变节点状态。
4. Graph 边只能来自 JunQi 本地发送意图或 OpenClaw 已收到的事件顺序；边必须带证据来源。缺少上游依赖或资源键时，不能由客户端补造依赖关系；独立 tool 节点可以并发记录。
5. 节点状态至少包含 `pending`、`running`、`succeeded`、`cancel_requested`、`cancelled`、`rolled_back`、`verification_required`、`failed` 和 `blocked`。
6. Stop 必须先持久化 stop intent 与一致 checkpoint，再执行本地输出中断和官方 `sessions.abort`。
7. 只有 Gateway 确认中断或权威 history 确认终态后，Task Run 才能从 `cancel_requested` 转入终态。
8. 工具调用已出现但没有权威结果时，必须进入 `verification_required` 或经 OpenClaw 回滚确认的 `rolled_back`；不得由客户端伪造 Tool Result。
9. Resume 先校验 Gateway identity、session identity 和 history，再加载最后一致 checkpoint。身份不匹配时阻止恢复并保留诊断。
10. 模型切换创建新的 Task Run；未核验工具节点不能被带入新模型上下文作为完成事实。
11. 有副作用的工具节点默认不可自动重试。只有工具提供稳定幂等键或可验证查询结果时才允许继续；否则要求人工确认。
12. 同一 `sessionKey` 同时最多一个活动 OpenClaw Chat Run。不同 Task 的无依赖节点只有资源键、Gateway identity 和运行时均不冲突时才可并发。
13. Jarvis 的唤醒、收音、识别、发送、播放和打断都必须映射到 Task Run，不能绕过持久 Task 状态机。

## 失败关闭

- 无法读到权威 history、Gateway identity 改变、session identity 改变或 abort 回应未知时，Task 保持 `verification_required`，不自动恢复或重试。
- 工具名称、调用 ID、参数摘要或结果无法被协议解码时，不猜测工具状态。
- 不能把 LiveKit、浏览器 WebRTC、第三方 STT/LLM/TTS 服务作为隐式回退运行时。
- 重启后不存在 checkpoint 时，只按现有 OpenClaw history 呈现会话；不声称恢复了 Task Graph。

## 验收条件

- Stop 期间刷新应用后，能按 session identity 找回 Task、最后一致 checkpoint 和中断原因。
- 任一 `verification_required` 副作用节点都无法通过自动重试变成完成。
- 冷启动、网络断开重连、模型切换和重复 Stop 不会产生重复 Chat Run 或重复副作用。
- 图的 revision、事件时间和资源锁能够重建确定性只读投影。
- Jarvis 的打断延迟、abort 到终态延迟、history 核验延迟可观测，但日志不包含密钥、原始音频或完整工具载荷。
- 通用 Chat、Quick Chat、Jarvis、Dynamic Island 与宠物只通过定义的 intent/projection 边界访问任务状态。

## 实施状态

2026-08-02 已实现 Task Run、Node、最小 Graph Edge checkpoint、Run 前持久化、Stop 前 cancel intent、Gateway 终态结算、工具 `verification_required` 状态、按 Run/Node/Edge 的跨 WebView 合并，以及 `chat.history` 的持久核验时间与活动 Run 观察。该 history 核验不推断工具结果。Gateway adapter 还提供了严格解码的原生 `tasks.list/get/cancel` 账本接口，后台 Task 不会替代 Chat transcript。

2026-08-03 继续实现了以下有官方依据或客户端持久化边界的行为：

- Stop 已从 JunQi 直接调用的 `chat.abort` 对齐到官方 `sessions.abort`。普通 Stop
  省略 `clearQueued`，只在精确 `abortedRunId` 确认后结算本地 Run；`no-active-run`
  或缺少精确 ID 时进入 history/session reconciliation。

- `sessions.steer` 按官方 schema/handler 接入 Jarvis 语音抢话；旧 Run 在官方 `interruptedActiveRun` 确认前只保持 `cancel_requested`，新 Run 作为发送意图持久化，未确认的网络结果不会被标记为成功。
- Gateway transport 的 `AbortSignal` 只切断客户端等待，不伪造远端取消；远端状态仍由 OpenClaw 控制面和 history 负责核验。
- checkpoint 允许可选工具字段缺失，并规范化旧版本历史/恢复字段；本地 `effectKey` 只用于 JunQi 关联，不替代 OpenClaw 的 `tools.invoke.idempotencyKey`。
- 冷启动后的 Chat 和 Quick Chat 显示只读的 `verification_required` 核验提示，并把按钮连接到官方 `chat.history`；该按钮不自动恢复、重试或改变 OpenClaw 状态。
- 每个 Run 记录发送时可观察到的模型身份；session identity 轮换生成新的 Task checkpoint。无 `sessionId` 的 Stream 结束、Tool event 和 Stop 回调只在同一 attested runtime 下存在唯一 checkpoint 时解析到该任务，候选不唯一则失败关闭。
- 本地队列排空路径也先创建 Task Run，再发送官方 `chat.send`，因此 Chat、Quick Chat 和 Jarvis 都经过同一 checkpoint 边界。

以下验收条件仍未完成且不能被客户端伪造：真实 Gateway 中工具进程中断的复现、真实副作用工具的幂等/查询/补偿策略、`tasks.*` 账本与 Chat Task 的自动关联、自动恢复或自动重试，以及 macOS/Windows/CentOS/Ubuntu 的真机麦克风、后台常驻和发布验收。
