# OpenClaw 原生模型认证状态对齐

日期：2026-08-03

## 审计结论

JunQi 的 Provider 页面此前主要根据选定 runtime 的配置判断“已配置”或“需要 API Key”。这只能说明
配置形状，不能说明 Gateway 计算出的 OAuth、token 或静态凭据是否已缺失、即将到期或过期。

当前 OpenClaw 提供 `models.authStatus` 的 `operator.read` 状态投影、`models.authLogout` 的
`operator.admin` 受控注销，以及 `models.probe` 的 `operator.admin` 有界实时验证。JunQi 将认证状态作为 Provider 卡片内
独立于本地配置结论的 Gateway 事实呈现，不再把本地配置推断为认证成功；只有官方状态明确标记可注销的已保存
OAuth/token Profile 时，才在卡片展开区提供二次确认后的官方注销操作。实时验证只在用户确认后执行，不随页面加载
自动消耗 Token。

## 权威依据

- [OpenClaw Gateway 方法权限目录](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)
- [OpenClaw models.authStatus handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/models-auth-status.ts)
- [OpenClaw models.authStatus 类型](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/models-auth-status.types.ts)
- [OpenClaw Gateway 协议参数](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)

官方方法目录将 `models.authStatus` 标为 `operator.read`。当前 handler 返回时间戳、provider id/display name、
provider/profile health status、可选 expiry、API-key 来源和可选 usage。其认证状态仅为 `ok`、`expiring`、
`expired`、`missing`、`static`，profile 类型仅为 `oauth`、`token`、`api_key`。

## 当前实现

- 新增 identity-fenced `models.authStatus` client。Gateway 返回未知方法、断线和连接切换均归类为不可用，
  且不会写入旧 Gateway 的结果。
- 严格验证 timestamp、provider/profile status、profile type 和 expiry 的完整形状。expiry 的 `remainingMs` 保留官方
  expired 状态可返回的负值；畸形回包不会生成健康状态。
- RPC 不传 `agentId`，因此由官方 handler 选择 Gateway 配置的默认 Agent；客户端不根据 Provider 页面配置猜测
  其他 Agent 的认证状态。
- React 状态只保留 provider id/display name、provider/profile status、expiry 和官方 `logoutSupported` 布尔能力。
  API-key source、环境变量名、profile id、reason code、usage、account email、billing、plan 和任何 Secret 均不进入前端
  状态、日志、持久化或 UI。
- Provider 页把 Gateway 认证状态合并到对应 Provider 卡片的摘要区，但不改变本地配置事实：有官方投影时，状态标签、
  状态点和必要的到期时间显示官方认证健康；没有官方投影时仍只显示“凭据已配置”等本地配置结论。首次加载读取当前
  快照；用户手动刷新和注销后的同步明确发送官方 `models.authStatus { refresh: true }`，不把刷新解释为登录、凭据修复
  或后续模型请求一定成功。
- 删除原独立认证面板及其标题、说明、Profile 数量和重复 Provider 行。Gateway 不支持该方法时不占用页面空间，也不
  伪报健康；畸形回包在 Provider 列表标题下显示就近警告。全局刷新收敛为列表标题操作，Provider 级实时验证保留在
  卡片摘要区，注销只在展开区作为次要危险操作出现。
- 可注销 Provider 显示官方认证注销入口。用户确认后，JunQi 通过临时 `operator.admin` 连接调用
  `models.authLogout { provider }`，由 OpenClaw 删除该 Provider 当前 Agent 下可删除的 OAuth/token Profile、刷新
  运行时认证快照，并按官方规则中止需要中止的运行。JunQi 不传 Profile id、不读取认证存储，也不自行删除配置。
- Gateway 报告的 Provider 可由用户主动选择“实时验证”。确认文案明确该操作会产生一个最多 8 Token 的官方
  `models.probe { provider }` 请求，并可能产生少量费用或触发速率限制。Renderer 只保留 provider、官方状态、延迟和
  目标数量，不保留 Profile id、label 或上游错误详情；认证状态刷新或 Gateway 状态变化后清除旧探测结果。

## 权限与跨平台边界

`models.authStatus` 使用既有日常 `operator.read` 连接。`models.authLogout` 与 `models.probe` 只在用户明确确认后
通过现有临时 privileged requester 申请 `operator.admin`，不把管理权限加入日常连接。三者都不读取本机路径、系统
凭据库或浏览器 API，而是通过 Gateway WebSocket RPC 工作；macOS、Windows、CentOS 和 Ubuntu 不依赖系统特定
认证实现。

本轮同时核对了官方 `question.*`：该能力需要独立的常驻 `operator.questions` scope 才能接收
`question.requested`/`question.resolved` 事件。JunQi 现有日常连接有意仅请求 read/write scope，因此本轮不将
该权限静默加入连接或伪造提问通知；如需接入，必须单独设计显式授权、持续连接和旧 Gateway 兼容路径。

## 验证结果

- 2026-08-05 增量：核对 OpenClaw 官方 `main` 提交 `02f7ed0f`，确认 `models.authLogout`、
  `logoutSupported`、`models.probe`、`operator.admin` 和对应返回契约；同时核对已安装正式版本 `v2026.7.1-2`，其包含
  `models.authLogout`，但未包含 `models.probe` handler，因此实际调用会明确进入旧 Runtime 不支持路径，不使用 CLI
  fallback 或伪造结果。
- TypeScript 无输出类型检查通过。
- Provider 卡片认证摘要 3 项行为回归通过，覆盖官方状态覆盖本地配置标签、到期信息与实时验证入口、展开区探测证据与
  注销入口，以及缺少 Gateway 投影时保留本地配置结论。
- Gateway client 定向回归覆盖安全投影、敏感字段剔除、畸形 enum/expiry 拒绝、过期负 duration 保留、方法发现遗漏仍
  请求、未知方法、断线、connection fence 和已切换 Gateway 的旧响应丢弃。
- `pnpm lint`、`pnpm test`、`pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate` 和
  `pnpm build` 均通过。
- 本轮重设计后重新执行 `pnpm lint`、15 项认证链路定向回归、完整 `pnpm test`、`pnpm build`、
  `pnpm verify:openclaw-docs`、`git diff --check`、locale JSON 解析和全部修改文件 Emoji 扫描，结果均通过。

## 未验证边界

- 当前工作区未连接真实 Gateway，尚未验证实际 provider OAuth/token 到期、静态 key、外部 CLI 凭据、实时探测
  的 Token 消耗、计费、限流和 Gateway 认证错误的页面呈现。
- 尚未在 macOS、Windows、CentOS、Ubuntu 的 Tauri 安装包上完成真机验收。
- 尚未在真实 Tauri 中完成亮色、暗色、窄窗口、键盘焦点、加载、失败和空数据状态的视觉验收；当前自动化仅验证结构
  和显示契约。
