# OpenClaw Task 工具事件 Run 绑定审计

## 依据

- [OpenClaw Gateway session schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)
- [OpenClaw sessions.abort handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-abort.ts)
- 当前 `src/services/gateway/ChatHandler.ts`：工具生命周期事件以 `sessionKey`、`runId`、`toolCallId` 和阶段进入 JunQi。
- 当前 `src/task-execution/TaskExecutionCoordinator.ts` 与 `src/task-execution/stateMachine.ts`：Task checkpoint 按已验证 runtime、session key 和 native session identity 分隔；未结工具在终态时进入核验状态。

## 当前行为与缺口

一个相同的 OpenClaw session key 可以在 reset 后对应新的 native `sessionId`。JunQi 保留旧 Task checkpoint，以便保留已中断 Task 的本地恢复证据，同时为新 identity 建立新的 checkpoint。

工具事件不带 `sessionId`。此前 `recordToolEvent` 只按 session key 选择 checkpoint；当同一 key 有新旧两个 Task 时会拒绝猜测。因此新 Task 已经有本地 Run 且收到带该 Run ID 的官方工具事件时，工具节点仍不会记录。随后 Stop 虽会持久化取消意图，但该 Task 缺少未结工具节点，不能提示需要核验的工具副作用。

## 目标行为

在不向 OpenClaw 添加任何字段、不推断外部任务的前提下，工具事件可以用官方 `runId` 唯一关联到本地已知 Task：

1. 只考虑当前已验证 runtime 下、相同 session key 的 checkpoint。
2. 只接受恰好一个 checkpoint 已包含该 runId 的情况。
3. 未找到或出现多个候选时，保持不写入，避免把新事件归到旧 session identity。
4. 已关联的工具 start/update/result 继续由现有状态机记录；Stop 后有未结工具时仍进入 `verification_required`。

## 验证与边界

- 定向回归：`TaskExecutionCoordinator`、任务状态机、Gateway 工具流、Stop 与 run projection 测试共 103 项通过。
- 完整验证：`pnpm lint`、`pnpm test`（2672 项）、`pnpm build`、`pnpm verify:openclaw-docs` 通过。
- 回归测试覆盖 session key 重置后，新 session identity 的 runId 仍唯一指向新 Task；未知和重复 runId 继续拒绝。
- 本次不改变 `sessions.abort`、OpenClaw 队列、远端 transcript 或工具执行；macOS、Windows、Ubuntu/CentOS 真机行为不因本地 checkpoint 关联而变化，尚未进行真机验证。
