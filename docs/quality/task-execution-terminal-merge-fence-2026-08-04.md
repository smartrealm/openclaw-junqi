# Task 执行终态合并围栏

日期：2026-08-04

## 结论

`TaskExecutionCoordinator` 会在多个桌面视图或重试写入时合并本地 checkpoint。单体状态转换已经禁止将完成的工具节点改回活动状态，但 merge 原先优先选择较晚的 `updatedAt`。因此旧视图中延迟写入的 `running` run 或 node 快照，可能覆盖已经结束、取消、失败或需要核验的状态。

修复使合并在终态与活动态冲突时始终保留终态；两个终态之间继续沿用现有时间和状态优先级。因此，后到的权威 tool result 仍可收敛 `verification_required`，但旧的活动快照不能让 Stop 后的 checkpoint 回到活动状态。

## 权威边界

- [OpenClaw Gateway session schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts) 定义 `sessions.abort` 的可选 `runId` 与 `clearQueued`，后者不由普通 Stop 隐式启用。
- [OpenClaw Gateway Protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md) 规定 Gateway 拥有 `sessions.abort`、`chat.history`、工具事件及其远端执行结果。

JunQi 本地 Task 图只保存取消意图、已观察工具事件和核验入口；不合成 tool result，不重写 Gateway transcript，也不推断工具副作用结果。

## 验证

- 回归覆盖已终止 run 与 node 对较晚活动快照的合并，断言终态保持不变。
- 既有 `verification_required` 到权威终态的收敛和独立节点合并保持可用。
- 自动化验证与目标平台真机验证分开记录；本次不改变 macOS、Windows、CentOS 或 Ubuntu 的原生运行行为。
