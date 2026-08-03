# OpenClaw 审计终态追溯投影实施计划

## 实施顺序

1. 以当前安装版 `audit.list` schema 和 `agent.run.finished` action 为唯一协议依据。
2. 在 Gateway 审计服务层增加按 ledger sequence 选择最新 Agent 终态的纯函数。
3. 由审计 hook 向追溯面板提供终态；只有明确终态覆盖 transcript 顶部展示。
4. 为 `blocked`、`timed_out`、`unknown` 补齐状态图标、主题映射和三种语言文案。
5. 增加异常、工具终态和无 Agent 终态的回归测试，执行全量验证。

## 边界

- 不扩展或持久化 `ResponseGroup` 的 transcript 状态枚举。
- 不把工具终态、审计查询失败或没有记录解释为 Agent 终态。
- 不引入 `operator.approvals`，审计读取继续使用 `operator.read`。
