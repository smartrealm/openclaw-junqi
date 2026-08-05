# OpenClaw 原生工具调用对齐

日期：2026-08-03

## 结论

JunQi 的 Tools 页面现在可以在 OpenClaw 明确报告工具对所选 Session 有效时，通过官方
`tools.invoke` 发起一次 Gateway 工具调用。JunQi 只负责选择真实 Session、透传用户输入、
展示 Gateway 的原始成功或失败结果；工具解析、allow/deny、插件和渠道策略、审批以及
执行生命周期仍归 OpenClaw。

这不是聊天消息，也不是 JunQi 自己的 ReAct 节点：调用结果不写入 chat transcript、
Task ledger 或本地伪造的工具消息。网络层没有收到可验证响应时，JunQi 不自动重试；用户
必须先检查 Gateway 状态，再显式发起新的调用。

## 权威依据

- [OpenClaw Gateway protocol: Operator helper methods](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md#operator-helper-methods)
- [OpenClaw tools schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)
- [OpenClaw tools.invoke handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/tools-invoke.ts)
- [OpenClaw method descriptors](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)

官方方法目录将 `tools.invoke` 标为 `operator.write`。请求字段是必需的非空 `name`，以及
可选的 `args`、`sessionKey`、`agentId`、`confirm`、`idempotencyKey`。结果是 `ok`、
`toolName` 和可选的 `output`、`requiresApproval`、`approvalId`、`source`、`error`；
策略拒绝和审批要求可以作为 `ok: false` 的成功 RPC envelope 返回，不能被当成传输异常。
当前官方 handler 仍由 Gateway 决定实际工具和 Session 上下文，JunQi 不向请求添加未在
schema 中定义的字段。

项目实际安装的 OpenClaw 版本只用于本机复现 schema 和 handler，不作为能力开关。能力是否
可用以官方文档、schema、handler、方法目录和 Gateway 正式响应为准；保守发现列表不作为本地发送门禁。

## 当前行为

1. Tools 页面从真实 `sessions.list` 和 `tools.effective` 快照生成 Session、工具和描述选项；
   JunQi 不维护第二份工具目录，也不让用户调用未被 Gateway 报告为有效的工具。
2. 调用前检查 Session 仍存在、有效快照仍可取得、工具没有
   `deniedBySession`，并把 Gateway 计算出的 `agentId` 作为官方可选字段透传。
3. 当前连接若提供运行时身份，调用使用 `requestFenced` 锁定该身份；无法取得已验证身份
   时不发送副作用 RPC。测试桩没有该能力时只用于覆盖协议行为，不代表生产连接可跳过身份门禁。
4. 每次 UI 调用都会使用一个新的客户端幂等键并透传给 OpenClaw；JunQi 不宣称 Gateway
   会为该字段提供跨请求去重，也不在传输不确定时重放调用。
5. `confirm` 由用户明确勾选后才发送 `true`，表示请求 Gateway 在策略要求时进入审批模式；
   JunQi 不绕过 Gateway 审批，也不本地批准或拒绝工具。
6. `ok: true`、`ok: false`、审批标识、错误 code/message/details 和结构化 output 只在
   当前面板内存展示，不进入聊天记录、Task 图或持久化日志。

## 验证

- `OpenClawToolsInvokeClient.test.ts` 覆盖官方请求字段、成功结果、审批失败结果、非法
  响应和输入校验。
- `gatewayDataStore.test.ts` 覆盖有效工具门禁、连接 fence、幂等键透传和 Gateway 未知方法的
  不可用映射。
- 已执行目标测试、`pnpm lint`、完整测试、TypeScript、生产构建、官方链接、差异和无
  Emoji 检查（结果记录在提交前更新）。

## 未验证边界

- 尚未连接真实 Gateway 现场验证不同 core/plugin/channel/MCP 工具的副作用、审批策略和
  output 形状；未把 `approvalId` 是否由具体 handler 返回推断为必然事实。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机完成 Tools 页面、断线重连和跨平台 WebView
  JSON 编辑器验收。
- 该面板不替代聊天中的模型 ReAct 工具调用，也不创建 JunQi 自有工具、MCP 连接或任务状态。
- OpenClaw 官方 schema、handler、权限目录变化时，必须重新核对源码后更新适配器。
