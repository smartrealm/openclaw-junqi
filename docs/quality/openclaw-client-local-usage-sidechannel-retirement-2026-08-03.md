# OpenClaw 客户端本机用量旁路退役记录

日期：2026-08-03

## 结论

JunQi 是 OpenClaw Gateway 的桌面客户端，不是 Claude Code 或 Codex CLI 的账户用量客户端。已移除 AgentRunView
的本机额度旁路：它曾读取 Claude OAuth 凭据并直接请求 Anthropic，也会自行启动 Codex app-server。该路径既不经过
OpenClaw Gateway，也不能将其结果可靠归属到某一个本地 PTY 任务。

## 权威依据

- [OpenClaw Gateway 方法权限目录](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)
- [OpenClaw Gateway 协议](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw usage.status handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/usage.ts)
- [OpenClaw 用量缓存与默认 Agent 作用域](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/models-auth-status-usage-cache.ts)

官方 `usage.status` 是 `operator.read` 的 Gateway 方法。其 handler 不接收客户端给定的 Agent，而是读取 Gateway
配置的默认 Agent。因此，该返回可在 Provider 页面作为 Gateway 提供方配额摘要展示，但不能作为 AgentRunView 中某个
本地 CLI 任务的额度。JunQi 不得伪造这种一对一归属。

## 变更

- 删除 `useUsageSnapshot`、其测试及 Windows 专属禁用开关。
- 删除 Tauri `read_usage_snapshot` command、Claude OAuth 本机凭据读取、Anthropic 用量请求和 Codex app-server 用量请求。
- 删除 Tauri command 注册与未引用的本机额度类型。
- AgentRunView 不再显示由本机 CLI 读取的 5h 或 7d 额度。
- 保留 Provider 页的 `usage.status` 客户端展示；它仍受当前 attested Gateway connection、广告方法和严格返回校验约束。

## 跨平台边界

移除的路径含 macOS Keychain、POSIX 凭据文件和 Windows 显式不可用分支。退役后，JunQi 不依赖 macOS、Windows、CentOS
或 Ubuntu 的本机 Claude/Codex 凭据路径来显示配额。实际配额能力只由连接的 OpenClaw Gateway 与其 provider runtime
决定。

## 验证

- `pnpm exec tsx --test src/pages/AgentRunView.test.ts` 通过，25 项通过。
- `pnpm exec tsc --noEmit`、`cargo fmt -- --check`、`cargo check --lib` 通过。
- `pnpm lint`、`pnpm test`、`pnpm test:rust`、`pnpm verify:openclaw-docs`、`pnpm collab:test`、
  `pnpm collab:validate` 和 `pnpm build` 通过。
- Rust 库测试共 690 项：687 项通过，3 项因 macOS Keychain 或官方语音模型夹具未配置而按条件忽略，零失败。
- 提交前已执行残留命令检索、`git diff --check` 和完整修改文件 Emoji 扫描。

## 未验证边界

- 本轮不验证真实 Gateway 的 provider 配额回包；该路径由既有 Provider 页面契约覆盖。
- 本轮不在 macOS、Windows、CentOS 或 Ubuntu 安装包上做真机验收；自动化仅验证已退役的本机旁路不再编译或注册。
