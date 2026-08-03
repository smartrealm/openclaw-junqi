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
4. 前端投影只可包含 provider id/display name、provider/profile status 和 expiry。不得包含 API-key source、
   环境变量、profile id、reason code、usage、账户信息、计划、计费或 Secret。
5. 页面必须将 Gateway 状态与本地 Provider 配置事实分开呈现；不存在状态、未支持和无效回包均不得显示为已认证。
6. 本项不得调用 `models.authLogout`、登录命令、配置写入、凭据刷新或本地认证回退。

## 非目标

- 不实现 OAuth 登录、注销、token 刷新、用量、账户或计费面板。
- 不扩大日常 Gateway scope，不接入需要独立长期 `operator.questions` scope 的问题事件。
- 不依赖 macOS、Windows、CentOS、Ubuntu 的凭据库、路径、系统 TTS 或浏览器 API。

## 验收

1. 已广告的 Gateway 上显示严格验证后的认证状态；不支持、断线和错误状态如实显示。
2. 敏感或不必要的上游字段不进入 React 状态或 UI。
3. 定向回归、静态检查、完整验证、文档和跨平台未验证边界均有明确记录。
