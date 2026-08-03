# Agent 主会话投影修复记录

日期：2026-08-03

## 发现

OpenClaw 2026.7.1-2 将每个 Agent 的 direct-chat 主会话固定投影为
`agent:<agentId>:main`。JunQi AgentHub 原先把所有非 cron/subagent 会话归为 `main`，并
从排序后的 sessions 列表取第一条，因此普通渠道会话或 fork 会话可能显示为主 Agent。ChatTabs
也只把 `agent:main:main` 当作不可关闭的主标签。

## 修复

- `src/utils/sessionPresentation.ts` 增加 canonical main 分类和按 Agent 精确查找函数。
- AgentHub 只把 `agent:<agentId>:main` 归为 main，普通会话归为 conversation；main card 不再
  依赖 sessions 列表顺序。
- ChatTabs 对所有 Agent 的 canonical main 使用统一的不可拖拽/关闭保护。
- 没有写入 OpenClaw 配置，也没有新增本地 Thread 或 transcript 存储。

## 验证

- `src/utils/sessionPresentation.test.ts` 覆盖普通渠道会话、多个 Agent main key 和列表顺序。
- 其余验证结果记录在本次任务最终报告；真实多 Agent Gateway 手工验收仍待执行。
