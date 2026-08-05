# OpenClaw 原生模型认证状态对齐规格

日期：2026-08-03

## 目标

在 JunQi Provider 页面呈现当前 Gateway 的原生模型认证健康状态，并保持 Gateway 认证事实、本地配置草稿、
Secret 和实际模型调用结果相互独立。

## 契约

1. 只能调用官方只读 `models.authStatus`；methods 发现列表遗漏时仍发送官方 RPC，实际未知方法才显示不可用。
   不传 `agentId` 时，状态范围为官方 handler 选择的 Gateway 默认 Agent。
2. 请求必须绑定当前 attested Gateway connection；断线、未知方法、连接切换和畸形回包不得更新 UI。
3. 只接受官方 provider/profile status 和 profile type 枚举，expiry 必须具有完整的合法 timestamp、remainingMs
   和 label；expired 状态的 `remainingMs` 可为负值。
4. 前端投影只可包含 provider id/display name、provider/profile status、expiry 和官方 `logoutSupported` 能力。
   不得包含 API-key source、环境变量、profile id、reason code、usage、账户信息、计划、计费或 Secret。
5. 页面必须将 Gateway 状态与本地 Provider 配置事实分开呈现；不存在状态、未支持和无效回包均不得显示为已认证。
6. 只有至少一个官方 Profile 明确返回 `logoutSupported: true` 时，才能显示 Provider 级注销入口。
7. 注销必须由用户二次确认，并通过临时 `operator.admin` 连接调用 `models.authLogout { provider }`；不得传入从 UI
   猜测的 Profile id，不得直接修改认证存储或本地配置。
8. 注销成功后必须刷新 `models.authStatus`；失败时对话框保持可重试，并显示本地化的明确错误，不得展示可能包含
   上游认证详情的原始 Gateway 错误。
9. 页面加载和认证状态刷新不得自动执行模型探测。实时验证必须由用户确认可能产生少量费用或限流后，通过临时
   `operator.admin` 连接调用官方 `models.probe { provider }`；探测失败只显示本地化分类，不展示原始 Gateway 错误。
10. 探测结果只可保留 provider、官方状态、可选 latency 和目标数量；Profile id、label、账户信息和上游错误详情不得
    进入 React 状态或 UI。认证状态快照变化后必须清除旧结果，避免把旧 Gateway 事实显示为当前事实。
11. 初始状态加载可以读取 Gateway 快照；用户手动刷新或注销后同步必须发送官方 `refresh: true`，不得把缓存响应
    表示为一次新的认证状态读取。

## 非目标

- 不实现 JunQi 私有 OAuth 登录、token 刷新、账号池、用量或计费语义；注销只委托 OpenClaw 官方 RPC。
- 不扩大日常 Gateway scope，不接入需要独立长期 `operator.questions` scope 的问题事件。
- 不自动探测，不自行实现探测请求、模型选择、Token 上限或错误分类；这些语义由 OpenClaw 官方 `models.probe` 拥有。
- 不依赖 macOS、Windows、CentOS、Ubuntu 的凭据库、路径、系统 TTS 或浏览器 API。

## 验收

1. 已广告的 Gateway 上显示严格验证后的认证状态；不支持、断线和错误状态如实显示。
2. 敏感或不必要的上游字段不进入 React 状态或 UI。
3. 官方可注销能力出现时，用户确认后由 OpenClaw 完成注销并刷新状态；不可注销 Profile 不暴露操作。
4. 用户确认后可运行官方有界探测；页面加载不会触发探测，旧 Runtime 不支持时明确失败且没有 CLI fallback。
5. 定向回归、静态检查、完整验证、文档和跨平台未验证边界均有明确记录。
