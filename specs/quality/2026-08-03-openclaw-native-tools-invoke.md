# OpenClaw 原生工具调用对齐规格

日期：2026-08-03

## 目标

在不扩展 OpenClaw 协议、不伪造工具结果的前提下，为 JunQi Tools 页面提供一次性
`tools.invoke` 客户端入口。该入口必须绑定真实 Session 和 Gateway 运行时身份，保留
OpenClaw 的策略、审批和失败语义。

## 约束

1. 只能调用官方 `tools.invoke`，权限为 `operator.write`；请求字段只能来自官方 schema。
2. `sessionKey` 必须来自当前 Gateway 的真实 `sessions.list`；工具名必须来自当前 Session
   的 `tools.effective`，且不得标记为 `deniedBySession`。
3. Gateway 未广告方法、Session 已删除、有效工具快照不可验证或运行时身份未知时，不发送
   工具调用 RPC，并呈现明确的不可用状态。
4. 客户端必须接受官方 `ok: false` 结果和可选审批/错误字段；不得把策略拒绝改写成成功，
   也不得把合法失败 envelope 当成传输异常。
5. 每次调用只能显式发起一次网络请求；不得自动重试、把不确定结果写入 transcript、Task
   ledger 或本地工具消息。幂等键只按官方字段透传，不宣称本地或 Gateway 去重。
6. 不本地计算 allow/deny、profile、插件、渠道或 MCP 权限，不主动连接或创建 MCP。

## 验收条件

- 能力广告和有效工具均可验证时，用户可选择真实 Session、动态工具和 JSON object 参数，
  并看到 OpenClaw 返回的结构化 output、审批要求或错误详情。
- `tools.invoke` 未广告、工具无效/被拒绝、Session 消失、连接 fence 不匹配或返回结构
  非法时，界面不显示伪成功，不发送不受支持的 RPC。
- 传输异常不会自动重放副作用调用；用户可看到未收到可验证结果的错误信息。
- 自动化验证覆盖协议解析、能力门禁、Session/工具门禁和连接 fence；真实 Gateway 与
  macOS、Windows、CentOS、Ubuntu 现场验证单独记录。
