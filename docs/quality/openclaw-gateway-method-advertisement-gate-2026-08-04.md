# OpenClaw Gateway 方法广告发现边界修正

日期：2026-08-04

## 结论

`hello-ok.features.methods` 是 OpenClaw Gateway 的保守功能发现列表，不是全部可调用 RPC 的
授权或传输准入清单。官方协议明确指出，有些真实方法会有意不出现在该列表中。因此 JunQi
不得因某个方法缺失于该数组而在通用传输层拒绝发送。

此前审计错误地把本机安装版的 schema 与方法注册推断为严格发送门禁，并在
`GatewayConnection.request` 和 `requestFenced` 中加入本地拒绝。这会阻断原生 Gateway
仍支持但未列入发现列表的方法，违反“Gateway 是能力权威”的客户端边界。本次已撤销该门禁。

## 权威依据

- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol) 的“RPC method families”说明：
  `hello-ok.features.methods` 仅为保守发现列表，不能视为全部服务器方法枚举。
- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol) 规定 side-effecting RPC 的
  幂等键及服务器响应错误为方法、权限和参数的实际裁决。
- [OpenClaw chat handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/chat.ts)
  以每次 `chat.send` 的 `idempotencyKey` 维护 Gateway 侧去重和会话队列，不要求客户端通过
  `features.methods` 证明调用资格。

## 当前行为

- `request` 与 `requestFenced` 只保留连接、身份围栏、超时和协议帧边界；它们不会用方法广告
  代替 Gateway 的参数校验、scope 授权或插件方法注册。
- 未广告方法照常发往当前已验证的 Gateway，由 Gateway 返回正式响应或结构化错误。JunQi 不会
  写死方法列表、按名称前缀猜测能力，或伪造本地“不支持”结论。

## 验证结果

- `src/services/gateway/Connection.queue.test.ts` 覆盖普通及 identity-fenced 请求在方法未广告时
  仍各发送一次并接受 Gateway 响应。
- 定向 Gateway、存储层与技能运行时回归共 90 项通过，覆盖广告遗漏时仍请求，以及 Gateway
  实际返回未知方法时才映射为不支持。
- `pnpm exec tsc --noEmit` 通过。
- `pnpm lint`、`pnpm test`、`pnpm test:rust`、`pnpm build`、`pnpm verify:openclaw-docs`、
  `pnpm collab:test`、`pnpm collab:validate` 全部通过。
- `git diff --check`、修改 JSON 解析和完整修改文件 Emoji 扫描通过。

## 未验证边界

- 当前工作区未连接真实 Gateway；未在真实插件方法上验证官方发现列表的省略项。
- macOS、Windows、CentOS 与 Ubuntu 的真机验证仍需要独立执行；本修正不使用平台专属 API。
