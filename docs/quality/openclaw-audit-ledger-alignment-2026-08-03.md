# OpenClaw 审计账本与 JunQi 追溯对齐

日期：2026-08-03

## 结论

JunQi 的响应追溯现在通过 Gateway 的握手能力声明选择 OpenClaw 原生审计方法：

- 连接声明 `audit.activity.list` 时，调用版本化、metadata-only 的活动账本。
- 连接未声明该方法但兼容 `audit.list` 时，只对运行和工具过滤使用旧方法。
- 连接明确未声明两种方法，或查询需要消息方向、消息渠道而只有旧方法时，显示上游不支持，不伪造数据。
- 连接尚未提供能力列表时，遵循 OpenClaw 官方兼容规则调用 `audit.list`；这不是版本判断，也不是对能力的乐观推断。

JunQi 仍然只是 OpenClaw Gateway 客户端。审计账本由 OpenClaw 写入和授权，JunQi 只做协议适配、元数据展示和错误边界呈现。

## 权威依据

本次实现依据 OpenClaw 官方当前主线文档和源码：

- [Gateway protocol: Audit ledger RPC](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md#audit-ledger-rpc)
- [audit-activity.ts schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/audit-activity.ts)
- [hello-ok method advertisement](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md#handshake)

本机安装的 OpenClaw 2026.7.1-2 随包文档只提供旧的 `audit.list` schema。这个事实只用于兼容性验证，不用于把版本号写进客户端分支条件。官方主线文档明确要求新客户端在 Gateway 声明 `audit.activity.list` 时优先调用它，旧 Gateway 才按过滤条件回退 `audit.list`。

## 当前行为

- `src/services/gateway/Connection.ts` 在成功 `hello-ok` 后保存 `features.methods`，保留三态：已声明、明确未声明、尚未知道。
- `src/services/gateway/OpenClawAuditClient.ts` 严格校验两套官方响应的事件、状态、动作、actor、时间、序列号和 metadata-only 边界。
- `src/services/gateway/index.ts` 暴露 `gateway.listAuditEvents`，使用现有 `operator.read` 连接权限，不增加审批或管理员 scope。
- 主 Chat 与 QuickChat 的追溯面板按 `runId` 自动查询审计账本，展示来源、事件数、时间、动作、状态、actor、序列号和工具名。
- 面板明确说明审计记录不包含提示词、消息正文、工具参数、工具结果、命令输出或原始错误文本。

## 目标行为

- 只显示 Gateway 实际返回的事件，不由前端响应组 ID、文字内容或状态推断 OpenClaw 审计事实。
- 对 OpenClaw 主线新增的 inbound/outbound message 事件保留官方字段边界；当前追溯按 runId 查询时仍只会收到具备运行归属的记录。
- 对 30 天保留期、10 万条账本上限、审计配置关闭或尚未记录等合法情况保持“无记录/不可用”语义，不显示伪成功。
- Gateway 重连后重新读取方法声明，不复用旧连接的能力集合。

## 验证结果

已执行：

- `pnpm exec tsc --noEmit`
- Gateway、审计客户端、响应追溯和界面契约定向测试，共 24 项通过
- `OpenClawAuditClient` 测试覆盖新协议优先、旧协议回退、消息过滤限制、能力缺失、终态 error code 关联和 metadata-only 过滤
- `Connection` 测试覆盖能力三态和断开清理

## 未验证边界

- 当前工作区没有连接真实远端 Gateway，因此未做真实 `audit.activity.list` 或 `audit.list` RPC 的线上响应验证。
- 本机安装版本可能只返回旧方法；主线 activity schema 的测试使用官方源码定义的结构化 fixture，不声称本机 Gateway 已支持它。
- 审计账本是否启用、消息审计是否开启、账本是否已过期，仍由 OpenClaw Gateway 配置和运行状态决定；JunQi 不代替 Gateway 修改这些配置。
