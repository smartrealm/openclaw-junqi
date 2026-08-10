# OpenClaw 原生压缩检查点只读对齐

日期：2026-08-03

## 审计结论

JunQi 已能调用官方 `sessions.compact`，但 Session Manager 只显示会话记录中的压缩次数，
无法呈现 OpenClaw 已持久化的 compaction checkpoint。用户因此无法区分“曾发生压缩”与
“Gateway 当前可查询到的检查点”，也看不到官方生成的摘要、token 前后值和创建原因。

当前 OpenClaw 提供只读 `sessions.compaction.list` 与 `sessions.compaction.get`。本轮 JunQi 只在
用户显式展开一个会话时调用 `sessions.compaction.list`；该官方列表已返回每个 checkpoint 的完整
元数据。JunQi 不调用 `get`，也不把 checkpoint 当作聊天任务状态，不自动创建 branch、
restore、rewind 或修改 transcript。

## 权威依据

- [OpenClaw sessions protocol schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)
- [OpenClaw compaction query handlers](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-compaction-queries.ts)
- [OpenClaw method descriptors](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)
- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol)

`sessions.compaction.list` 与 `sessions.compaction.get` 需要 `operator.read`。返回的 checkpoint
包含 Gateway 生成的身份、原因、时间、可选 token 值、摘要及压缩前后 transcript 引用。branch
需要 `operator.write`，restore 需要 `operator.admin`；本轮不触发它们。

## 目标行为

- 仅在用户展开一个 Session 卡片时请求其 checkpoint 列表，并直接呈现列表返回的官方 metadata。
- 请求与返回绑定当前已认证 Gateway connection；重连、会话切换、关闭面板或请求代次变化后，迟到结果不得写入 UI。
- Gateway 返回未知方法、断线、拒绝访问或无效列表响应时显示当前失败状态并清空该次数据；不显示旧缓存或本地伪 checkpoint。
- Session Manager 只呈现 Gateway 元数据。任何 branch、restore、自动恢复、token 估算或 transcript 修改均不在本轮范围内。

## 未验证边界

- 当前工作区未连接真实 Gateway，尚未验证实际 checkpoint 数量、自动压缩原因、远程 agent、授权拒绝和列表读取期间的生命周期变化。
- 尚未在 macOS、Windows、CentOS、Ubuntu 的 Tauri 安装包中验证展开、断线和重新连接后的呈现。

## 验证结果

- checkpoint client 回归覆盖官方请求字段、合法 metadata、schema 允许的极端安全整数时间值、未知 reason 拒绝、方法发现遗漏仍请求和断线围栏；Session Manager 时间格式化回归覆盖超出 JavaScript `Date` 范围的值。
- Session Manager 复用既有会话状态层回归；定向 checkpoint、时间范围回归、Jarvis、语音和 Gateway data store 测试通过，
  `pnpm lint`、`pnpm test`（2,494 项）和 `pnpm verify:openclaw-docs` 已通过。
- 真实 Gateway、目标平台和 checkpoint 生命周期竞态仍按上述边界待验证。
