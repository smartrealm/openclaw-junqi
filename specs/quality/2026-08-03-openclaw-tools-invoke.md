# OpenClaw tools.invoke 受控调用规格

日期：2026-08-03

## 依据

- 本机 OpenClaw `2026.7.1-2` 的 `gateway/protocol.md`：`tools.invoke` 使用
  `operator.write`，参数为 `name` 以及可选的 `args`、`sessionKey`、`agentId`、`confirm`、
  `idempotencyKey`。
- OpenClaw 当前协议要求同时提供 `sessionKey` 与 `agentId` 时，两者解析出的 Agent 必须一致；
  owner-only core wrapper 仍要求 `operator.admin`，不能由客户端绕过。
- `tools.effective` 是当前会话的服务端生效工具投影，JunQi 不自行维护第二份可调用工具清单。

## 目标行为

1. JunQi 只从当前会话最近一次 `tools.effective` 结果中选择调用目标，不提供任意字符串命令入口。
2. 参数只接受 JSON object；调用使用当前 session key 和 Agent id，并生成一次性幂等键。
3. 每次调用前显示确认；确认后调用官方 `tools.invoke`，由 Gateway 继续执行工具策略与审批。
4. 严格解析 `ok`、`toolName`、`output`、`requiresApproval`、`approvalId`、`source` 和结构化
   `error`，不把失败响应伪装成成功。
5. 输出只在当前面板内临时展示，不写入 JunQi 持久化状态、日志、Markdown 或提交记录。

## 不做的事情

- 不调用 `operator.admin` 代替 `operator.write`。
- 不自行判断工具是否安全，不绕过 Gateway policy、approval 或 owner 权限。
- 不猜测工具参数 schema；当前 `tools.effective` 没有提供参数 schema 时，面板只接受用户输入的
  JSON object。

## 验收条件

- 缺少工具名、非 object 参数、空 session key 或非法响应会在本地失败并保留明确错误。
- 成功、策略拒绝、需要审批和工具错误均保留 Gateway 的结构化结果。
- 面板中的工具只能来自当前会话 effective tool 投影；刷新后服务端仍是最终权威。
- 简体中文、繁体中文和英文均有调用面板文案。

## 未验证边界

- 未连接真实 Gateway 执行会产生外部效果的工具；本轮只验证协议解析、调用参数和 UI 调用链。
- 未验证 owner-only wrapper、插件审批和 MCP 工具在真实安装中的具体交互文案；这些仍由 Gateway 返回结果决定。
