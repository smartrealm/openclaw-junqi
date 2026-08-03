# OpenClaw 原生模型认证状态对齐

日期：2026-08-03

## 审计结论

JunQi 的 Provider 页面此前主要根据选定 runtime 的配置判断“已配置”或“需要 API Key”。这只能说明
配置形状，不能说明 Gateway 计算出的 OAuth、token 或静态凭据是否已缺失、即将到期或过期。

当前 OpenClaw 提供 `models.authStatus` 的 `operator.read` 只读投影。JunQi 将该状态作为 Provider 页的独立
Gateway 事实区呈现，不再把本地配置推断为认证成功，也不发起登录、注销、刷新凭据或配置写入。

## 权威依据

- [OpenClaw Gateway 方法权限目录](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)
- [OpenClaw models.authStatus handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/models-auth-status.ts)
- [OpenClaw models.authStatus 类型](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/models-auth-status.types.ts)

官方方法目录将 `models.authStatus` 标为 `operator.read`。当前 handler 返回时间戳、provider id/display name、
provider/profile health status、可选 expiry、API-key 来源和可选 usage。其认证状态仅为 `ok`、`expiring`、
`expired`、`missing`、`static`，profile 类型仅为 `oauth`、`token`、`api_key`。

## 当前实现

- 新增 identity-fenced `models.authStatus` client。明确未广告、未知方法、断线和连接切换均归类为不可用，
  且不会写入旧 Gateway 的结果。
- 严格验证 timestamp、provider/profile status、profile type 和 expiry 的完整形状。expiry 的 `remainingMs` 保留官方
  expired 状态可返回的负值；畸形回包不会生成健康状态。
- RPC 不传 `agentId`，因此由官方 handler 选择 Gateway 配置的默认 Agent；客户端不根据 Provider 页面配置猜测
  其他 Agent 的认证状态。
- React 状态只保留 provider id/display name、provider/profile status 和 expiry 摘要。API-key source、环境变量名、
  profile id、reason code、usage、account email、billing、plan 和任何 Secret 均不进入前端状态、日志、持久化或 UI。
- Provider 页将 Gateway 认证状态与本地配置卡片并列呈现。用户可以显式刷新状态；本项不把刷新解释为登录、
  凭据修复或后续模型请求一定成功。

## 权限与跨平台边界

`models.authStatus` 使用既有日常 `operator.read` 连接，不增加 `operator.admin`、`operator.approvals` 或其他
scope，也不读取本机路径、系统凭据库或浏览器 API。它通过 Gateway WebSocket RPC 工作，macOS、Windows、
CentOS 和 Ubuntu 不依赖系统特定认证实现。

本轮同时核对了官方 `question.*`：该能力需要独立的常驻 `operator.questions` scope 才能接收
`question.requested`/`question.resolved` 事件。JunQi 现有日常连接有意仅请求 read/write scope，因此本轮不将
该权限静默加入连接或伪造提问通知；如需接入，必须单独设计显式授权、持续连接和旧 Gateway 兼容路径。

## 验证结果

- TypeScript 无输出类型检查通过。
- 7 项定向回归通过，覆盖安全投影、敏感字段剔除、畸形 enum/expiry 拒绝、过期负 duration 保留、未广告零请求、未知方法、断线、
  connection fence、已切换 Gateway 的旧响应丢弃，以及 UI 不可用状态。
- `pnpm lint`、`pnpm test`、`pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate` 和
  `pnpm build` 均通过。
- 提交前已执行 `git diff --check`、locale JSON 解析和全部修改文件 Emoji 扫描。

## 未验证边界

- 当前工作区未连接真实 Gateway，尚未验证实际 provider OAuth/token 到期、静态 key、外部 CLI 凭据和 Gateway
  认证错误的页面呈现。
- 尚未在 macOS、Windows、CentOS、Ubuntu 的 Tauri 安装包上完成真机验收。
