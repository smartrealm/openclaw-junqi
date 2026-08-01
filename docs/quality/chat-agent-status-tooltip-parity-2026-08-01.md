# 会话 Agent 状态卡一致性记录

日期：2026-08-01

## 依据

- `src/App.tsx` 将 Gateway `sessions.list` 的每个会话的模型、思考等级、已用 token、上下文窗口和压缩计数投影到 `Session`。
- `src/stores/chatStore.ts` 在当前会话切换时把当前会话元数据投影为实时标题栏状态。
- `src/components/Chat/ChatTabs.tsx` 原先把状态卡绑定到固定的 `agent:main:main` 标签，并在卡片内部再次固定检索该会话。

## 原有行为

- 只有主智能体的规范会话标签可显示状态卡。
- `legal`、`novelsmith` 等 Agent 已有规范会话标签和 Gateway 元数据，却没有相同入口。
- 状态卡在 Gateway 没有返回上下文窗口时擅自显示 200k，可能造成错误理解。

## 当前行为

- 每个 `agent:<agentId>:main` 标签均可悬浮显示同一个状态卡。
- 卡片名称、模型、会话时长、token、压缩计数和思考等级都对应被悬浮的会话。
- 当前会话可使用实时 token 快照；非当前会话只使用自身的 `sessions.list` 投影，不串用主智能体数据。
- Gateway 未提供上下文窗口时显示未知，不再构造默认 200k 数据。

## 验证

- `src/components/Chat/agentStatus.test.ts` 覆盖当前会话实时数据、非当前 Agent 会话隔离和缺失上下文窗口。
- `src/components/Chat/chatProductionHardening.test.ts` 断言所有规范 Agent 会话使用统一悬浮入口，且状态卡不再固定读取主会话。
- 仍需在真实 Gateway 返回多个 Agent 的会话元数据时做桌面端交互验收；该验证不能由静态测试替代。
