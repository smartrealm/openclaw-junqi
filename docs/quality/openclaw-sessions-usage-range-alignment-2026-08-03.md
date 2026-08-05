# OpenClaw 会话用量范围对齐

日期：2026-08-03

## 结论

JunQi 的 Full Analytics 现在把界面预设转换为 OpenClaw 原生 `sessions.usage` 请求参数。之前只传 `limit` 和 `agentScope`，Gateway 会按官方默认范围返回数据，界面显示的 7 天、30 天、90 天、自定义和全部范围因此不能保证与服务端查询范围一致。

本次修复只使用官方请求字段，不通过客户端版本号选择分支，也不在客户端把返回数据扩展到 Gateway 没有返回的日期。

## 权威依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw usage handlers](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/usage.ts)

官方 `sessions.usage` 支持 `range`、`startDate`、`endDate`、`mode`、`timeZone`、`utcOffset`、`limit` 和 `agentScope` 等参数；当调用方不传范围时，Gateway 有自己的默认范围。返回结构包含 `updatedAt`、`startDate`、`endDate`、`sessions`、`totals` 和 `aggregates`，其他字段由 Gateway 自己扩展。

## 当前行为

- 7 天、30 天、90 天和全部范围分别传入官方 `range` 值。
- 自定义日期传入官方 `startDate` 和 `endDate`，不把日期换算成客户端猜测的天数。
- 请求继续显式使用 `agentScope: "all"`，保持全局分析口径。
- 响应解析要求官方顶层时间范围、会话数组、费用总计和聚合对象存在且类型正确；未知扩展字段保留，不生成缺省业务数据。
- 会话行必须包含官方稳定标识 `key`，`sessionId` 和 `updatedAt` 按官方类型可选，`usage` 必须存在且为对象或 `null`；非法行使整次响应进入不可用状态，避免分析页混入伪数据。
- Analytics 仍可对已取回的数据做本地视图过滤，但不会宣称已取得 Gateway 返回范围之外的记录。

## JunQi 边界

OpenClaw 负责用量统计、日期范围和费用计算。JunQi 负责把桌面控件映射到官方请求、缓存合法响应并呈现空状态。JunQi 不实现自己的费用聚合协议、不猜测缺失日期，也不以安装包中的 OpenClaw 版本号作为能力开关。

## 验证结果

- `pnpm exec tsc --noEmit` 通过。
- `gatewayDataStore` 与 `useAnalyticsData` 定向测试 7 项通过。
- `git diff --check` 通过。

## 未验证边界

- 当前工作区未连接真实 Gateway，未完成不同 Gateway 配置下的 `sessions.usage` 联机验证。
- Windows、CentOS、Ubuntu 和不同本地时区的真实桌面验收仍需在目标环境执行；本次改动只使用 Gateway 官方日期字段，不能替代平台测试。
- 如果官方协议新增或调整字段，必须重新核对文档、schema 和 handler 后再调整解码器；未知字段保持不可用或保留，不做猜测性兼容。
