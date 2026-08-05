# OpenClaw 原生提供方配额对齐

日期：2026-08-03

## 审计结论

JunQi Provider 页面此前仅能显示本地配置和 Gateway 认证健康，无法呈现 Gateway 已知的提供方配额窗口。
`src/hooks/useUsageSnapshot.ts` 仍为 AgentRunView 读取本机 Claude/Codex CLI 的历史路径，Windows 明确不可用；它不是
Provider 配置页面的权威来源，也不应作为 Gateway 配额的 fallback。

当前 OpenClaw 提供 `usage.status` 的 `operator.read` 配额摘要。JunQi 将其作为独立的 Gateway 事实区呈现，并且不将
其理解为本机 CLI 使用量、供应商账单或后续请求成功保证。

## 权威依据

- [OpenClaw Gateway 方法权限目录](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)
- [OpenClaw Gateway 协议](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw usage.status handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/usage.ts)
- [OpenClaw 提供方用量类型](https://github.com/openclaw/openclaw/blob/main/src/infra/provider-usage.types.ts)
- [OpenClaw 用量缓存与默认 Agent 作用域](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/models-auth-status-usage-cache.ts)

官方目录将 `usage.status` 标为 `operator.read`。handler 不接收客户端指定 Agent，按 Gateway 配置的默认 Agent 读取；
返回 `updatedAt` 和 provider 列表。每个 provider 包含 `provider`、`displayName`、配额 `windows`，每个窗口包含
`label`、`usedPercent` 和可选 `resetAt`。Gateway 在冷缓存时可等待其拥有的 provider usage 获取；JunQi 不绕开
Gateway 访问任何 provider 或本机 CLI。

## 当前实现

- 新增 identity-fenced `usage.status` client。Gateway 返回未知方法、断线和连接切换均归类为不可用，旧 Gateway 结果不会写入
  当前页面。
- 只严格投影 `updatedAt`、provider id/display name 与窗口 label、0 到 100 的 `usedPercent`、可选毫秒时间戳
  `resetAt`。畸形回包不会生成配额展示。
- 账户邮箱、套餐、账单、cost history、请求数、错误文本、API-key 来源、环境变量、profile id 和任何 Secret 不进入
  React 状态、日志、持久化或 UI。
- Provider 页面将配额窗口放在认证健康后方，采用明确的刷新操作和本地化时间格式；该操作不发起 Gateway 配置写入、
  凭据刷新、登录、注销或本机 CLI 调用。

## 权限与跨平台边界

该 RPC 使用既有日常 `operator.read` 连接，不增加 admin、talk、questions 或 approvals scope，也不依赖 macOS、Windows、
CentOS、Ubuntu 的文件路径、凭据库、浏览器 API 或本机 CLI。平台差异由当前 Gateway 的 provider runtime 决定；JunQi
只忠实显示其已验证回包。

## 验证结果

- TypeScript 无输出类型检查通过。
- 6 项定向回归通过，覆盖安全投影、账户/套餐/账单/错误文本剔除、畸形窗口拒绝、方法发现遗漏仍请求、未知方法、断线和
  connection fence。
- `pnpm lint`、`pnpm test`、`pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate` 和
  `pnpm build` 均通过。
- 提交前已执行 `git diff --check`、locale JSON 解析和全部修改文件 Emoji 扫描。

## 未验证边界

- 当前工作区未连接真实 Gateway，尚未验证冷缓存的 provider usage 请求、第三方 provider 限流、过期认证和配额窗口
  刷新后的真机呈现。
- 未在 macOS、Windows、CentOS、Ubuntu 的 Tauri 安装包上完成真机验收。
- AgentRunView 的本机 CLI 用量旁路已在后续的
  [`OpenClaw 客户端本机用量旁路退役记录`](openclaw-client-local-usage-sidechannel-retirement-2026-08-03.md) 中移除；它不再是
  Gateway 配额的 fallback。
