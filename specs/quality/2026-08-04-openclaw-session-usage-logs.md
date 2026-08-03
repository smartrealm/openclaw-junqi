# OpenClaw 会话用量条目对齐

## 目标

将 JunQi `/logs` 页面从猜测性“实时 Gateway 日志”改为 OpenClaw 原生
`sessions.usage.logs` 的只读会话用量条目视图。JunQi 只显示当前选定会话的官方条目，
不伪造日志等级、默认会话、实时流或系统健康含义。

## 约束

- 以 OpenClaw 当前 Gateway protocol、`server-methods/usage.ts`、
  `session-cost-usage-reporting.ts` 和 `session-cost-usage.types.ts` 为契约；安装版本仅用于
  本地复现，不作为能力门禁或版本分支。
- `sessions.usage.logs` 使用既有 `operator.read` 连接及 connection fence；只发送必填
  `{ key }`，不由 JunQi 编造 `limit`、`type`、时间范围或其他参数。
- Gateway 返回必须严格为 `{ logs: [...] }`。每个条目只投影 `timestamp`、`role`、`content`
  和可选非负 `tokens`；未知顶层或条目扩展字段不进入 UI 或状态。
- 初始会话来自当前 chat session；无当前会话时才使用 Gateway 已知会话列表。不得注入
  `agent:main:main` 或其他硬编码会话作为回退。
- 页面不轮询、不宣称 live stream；打开页面或用户切换会话时读取一次，用户可显式刷新。
  迟到响应、连接替换和断线不得覆盖当前选择。
- 错误仅呈现本地分类文案，不能展示原始 Gateway 错误、未脱敏内容或猜测性兼容解析。

## 验收条件

1. `/logs` 只通过 `OpenClawSessionUsageLogsClient` 调用原生 RPC；页面不直接调用 Gateway，
   不存在 array/entries/data 多形态猜测解析。
2. 客户端按 identity fence 发送 `{ key }` 并映射 Gateway method-not-found、断线和连接替换；
   `hello-ok.features.methods` 缺失不阻止实际请求。
3. 页面显示会话选择器、条目角色、时间、内容和可选 token，角色仅限 user/assistant/tool/toolResult。
4. 当前会话不存在于 Gateway 列表时可作为真实选择项保留；没有任何可用会话时不发送 RPC。
5. 三语文案齐全；不展示伪造 level、原始错误、自动刷新状态或原始未知字段。

## 不在范围内

- Gateway 文件日志、`logs.tail`、会话 history、工具审计、诊断 recorder、实时订阅或系统日志流。
- 会话内容编辑、删除、导出、成本货币格式化、自动刷新或本地 transcript 读取。
- OpenClaw 没有稳定返回的 provider/model/channel/工具 payload 详情。
