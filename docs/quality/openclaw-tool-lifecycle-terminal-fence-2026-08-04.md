# OpenClaw 工具生命周期终态围栏审计

## 依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)：Gateway 是唯一控制面，流式 agent 与工具结果只对具备 `operator.read` 的客户端广播；每个连接的广播序列单调递增。
- 当前 `src/processing/toolExecutionProjection.ts`：工具事件归一为 `start`、`update`、`result`，其 UI 状态分别可为 running 或终态。
- 当前 `src/services/gateway/ChatHandler.ts`：Task graph 对已经终态的工具节点不会重开，但工具卡的 update 分支此前无终态检查。

## 当前行为与缺口

工具卡收到 `result` 后以 `responseState: final` 固化结果。随后若接收延迟的 `update`，当前 UI 会用其 running 状态覆盖工具卡，而 Task checkpoint 状态机仍保留完成、失败或核验结论。

这会造成同一 OpenClaw 工具调用在持久恢复提示中已结束、聊天工具卡却显示运行中的矛盾。它不改变远端执行，但会误导用户判断 Stop 后是否存在未结副作用。

## 目标行为

1. 终态工具卡拒绝后到的 `start` 和 `update`，不能从终态退回 running。
2. 后到的 `result` 仍按既有逻辑处理，以允许权威结果关闭本地 `verification_required`。
3. 不重写、排序或合成 OpenClaw 事件，不向 Gateway 写入工具结果。

## 验证与边界

- 定向回归：Gateway 工具流、run projection、工具归一化、Task 状态与 Stop 测试共 106 项通过。
- 完整验证：`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs` 通过。
- 回归覆盖 result 后到达 update，断言工具卡保持终态输出和状态。
- 本次仅修复客户端展示投影；真实 Gateway 的工具事件顺序、跨平台运行和工具副作用仍以 OpenClaw 与目标工具为准，尚未做 macOS、Windows、Ubuntu/CentOS 真机验证。
