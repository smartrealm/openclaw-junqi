# OpenClaw 会话用量条目对齐

日期：2026-08-04

## 依据

本次调整以当前 OpenClaw 官方协议和源码为契约；已安装包只用于本地复现，不作为能力开关。

- [Gateway protocol](https://docs.openclaw.ai/gateway/protocol) 将 `sessions.usage.logs` 定义为
  单会话用量条目读取；该方法虽然可调用，但可能不出现在保守的 methods discovery 列表。
- [usage handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/usage.ts)
  要求非空 `key`，默认由 Gateway 限制返回量，并固定返回 `{ logs: logs ?? [] }`。
- [session usage reporting](https://github.com/openclaw/openclaw/blob/main/src/infra/session-cost-usage-reporting.ts)
  从指定 transcript 提取 user/assistant/tool/toolResult 条目，保留时间、角色、内容和可选用量。
- [session usage types](https://github.com/openclaw/openclaw/blob/main/src/infra/session-cost-usage.types.ts)
  定义 `SessionLogEntry` 的 timestamp、role、content、tokens 与 cost 字段。

## 当前行为

1. `OpenClawSessionUsageLogsClient` 以当前 attested Gateway identity 调用 `sessions.usage.logs`，
   严格发送 `{ key }` 并接受固定 `{ logs }` envelope。方法广告遗漏不会阻断调用；真实
   method-not-found、断线和连接替换才映射为不可用。
2. JunQi 投影 timestamp、四种官方 role、content 和可选 tokens；cost 和未知扩展字段不会进入
   页面状态。页面从不显示 Gateway 原始错误。
3. `/logs` 改为“会话用量条目”视图：初始选择 chat 当前 session，没有时选择 Gateway 已知会话。
   它不再硬编码 main session，不再声称 Live logs、伪造 level，也不再启动 5 秒轮询。用户可
   手动刷新，选择切换和 hook 请求版本共同防止旧响应覆盖新选择。
4. 这不是 Gateway 文件日志、诊断 recorder、工具审计或实时流；不会读取本地 transcript 或修改
   OpenClaw 配置。

## 验证结果

- `OpenClawSessionUsageLogsClient.test.ts` 覆盖请求 envelope、连接 fence、未知字段丢弃、
  malformed response、未广告方法、method-not-found、断线和连接替换。
- `LogsViewer.test.ts` 覆盖当前会话优先与无当前会话时的 Gateway 列表选择，证明不生成 main
  session 回退。
- 提交前执行定向测试、TypeScript、lint、完整测试、生产构建、官方链接校验、差异检查和
  Emoji 扫描。

## 未验证边界

- 未连接真实 Gateway 验证实际 transcript 内容、权限拒绝、默认上限或 read-only scope 现场行为。
- 未在 macOS、Windows、CentOS、Ubuntu 真机验证长文本、窄窗口、远程 Gateway 和无 session 的
  视觉表现；实现未使用平台专属 API。
- 未接入 `logs.tail`、自动刷新、成本货币显示、导出或任何基于未公开字段的展示。
