# Agent 主会话投影修复记录

日期：2026-08-03

## 发现

OpenClaw 官方会话模型将 Agent 的 direct-chat 根会话投影为 `agent:<agentId>:main`，并通过
`agents.list.mainKey` 返回当前默认智能体主会话的权威身份。JunQi AgentHub 原先把所有非
cron/subagent 会话归为 `main`，并从排序后的 sessions 列表取第一条，因此普通渠道会话或 fork
会话可能显示为主 Agent。

## 修复

- `src/utils/sessionPresentation.ts` 增加 canonical main 分类和按 Agent 精确查找函数。
- AgentHub 只把 `agent:<agentId>:main` 归为 main，普通会话归为 conversation；main card 不再
  依赖 sessions 列表顺序。
- 默认主会话由 `agents.list.mainKey` 确认，并在会话状态层固定为第一个不可拖拽、不可关闭页签；
  其他 Agent 的 canonical main 仍受远端删除保护，但不冒充默认主会话固定入口。
- 没有写入 OpenClaw 配置，也没有新增本地 Thread 或 transcript 存储。

## 验证

- `src/utils/sessionPresentation.test.ts` 覆盖普通渠道会话、多个 Agent main key 和列表顺序。
- 其余验证结果记录在本次任务最终报告；真实多 Agent Gateway 手工验收仍待执行。
