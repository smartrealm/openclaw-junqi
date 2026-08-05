# OpenClaw 会话目标入口围栏

日期：2026-08-04

## 结论

`gateway` facade 曾为 `tools.effective`、`sessions.preview`、`sessions.resolve` 和
`artifacts.list/get/download` 隐式填入主会话 key。其他直接入口也可能把空 key 传入
`sessions.describe`、`chat.history`、`chat.message.get`、`sessions.compact`、`sessions.delete`
或 `sessions.reset`，其中 delete/reset 会先进入本地 mutation coordinator。即使当前 React
调用方均已传入已选择的 Session，这些路径仍允许遗漏参数的 JavaScript 调用把操作静默定向或
排队到错误的会话。

会话组织的 `pinned`、`unread`、`archived` 与 `category` 也通过原生 `sessions.patch` 写入。
此前其客户端会在验证 key 前进入 mutation coordinator；现在同样在排队和请求前验证目标。

压缩检查点的 `sessions.compaction.list/get/branch/restore` 同样以原生 `key` 定向。此前
`branch` 和 `restore` 会在参数构建前进入 mutation coordinator，`list` 与 `get` 则使用另一种
本地错误。现在四者均复用相同守卫；公开 Promise API 对缺失目标统一返回 rejected promise。

现在上述入口及 fenced delete/reset 都要求显式 session key，并在建立 Gateway 请求或进入
本地 mutation coordinator 前复用 `requireOpenClawSessionTarget`。空白、缺失或非字符串目标统一返回
`OPENCLAW_SESSION_TARGET_REQUIRED`；不会触发默认会话请求，也不会把本地错误伪装成
Gateway 的读取结果。

## 权威依据

- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol)
- [OpenClaw tools.effective handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/tools-effective.ts)
- [OpenClaw artifacts handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/artifacts.ts)
- [OpenClaw sessions preview handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-preview.ts)
- [OpenClaw sessions resolve handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-resolve.ts)
- [OpenClaw sessions.patch handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/sessions-patch.ts)
- [OpenClaw session controller](https://github.com/openclaw/openclaw/blob/main/ui/src/ui/controllers/sessions.ts)
- [OpenClaw Gateway method scopes](https://github.com/openclaw/openclaw/blob/main/src/gateway/method-scopes.ts)

这些协议都以请求中明确给出的会话范围作为 Gateway 处理的输入。JunQi 只保留其桌面客户端
投影职责，不从主会话名称、当前开发环境或参数缺失推断一个目标。

## 验证

- `OpenClawSessionTarget.test.ts` 覆盖二十二个 facade 入口在连接请求或 mutation coordinator 前拒绝缺失目标。
- `OpenClawSessionOrganizationClient.test.ts` 证明四种 `sessions.patch` 组织写入均不会在缺失目标时进入 mutation coordinator 或 Gateway 请求。
- `SessionCompactionClient.test.ts` 与 `OpenClawSessionCompactionCheckpointsClient.test.ts` 证明四种检查点操作均不会在缺失目标时进入 mutation coordinator、读取连接或 Gateway 请求。
- 所有现有 React 调用方已审查并显式传入选中的 session key。
- 本轮执行 `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs` 与
  `git diff --check`。

## 未验证边界

- 未在真实 Gateway 上分别验证每个会话定向方法的多会话响应；本修复不改变其请求字段、权限或
  响应解码。
- 未进行 macOS、Windows、CentOS 或 Ubuntu 的目标平台真机验收。
