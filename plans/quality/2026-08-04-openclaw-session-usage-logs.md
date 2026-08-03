# OpenClaw 会话用量条目对齐实施计划

## 实施顺序

1. 核对当前 OpenClaw Gateway protocol、usage handler、reporting 实现和共享类型，确认
   `{ logs }` envelope、必填 key、角色枚举、内容来源和默认限制。
2. 新增严格 `OpenClawSessionUsageLogsClient`，使用已有 attested connection fence，并只请求
   `{ key }`、投影页面实际使用的字段。
3. 新增 hook 的最新请求栅栏；页面只能消费 hook 和 store 的当前会话/会话列表，移除直连 Gateway、
   默认主会话、猜测 response、伪 level 以及后台轮询。
4. 补充协议客户端与当前会话选择回归测试、三语资源和 docs/specs/plans 索引。
5. 执行定向测试、TypeScript、lint、完整测试、构建、官方链接校验、diff 检查与 Emoji 扫描后中文提交。

## 文件范围

- `src/services/gateway/OpenClawSessionUsageLogsClient.ts`
- `src/services/gateway/OpenClawSessionUsageLogsClient.test.ts`
- `src/services/gateway/index.ts`
- `src/hooks/useOpenClawSessionUsageLogs.ts`
- `src/pages/LogsViewer.tsx`
- `src/pages/LogsViewer.test.ts`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 `docs/`、`specs/`、`plans/` 索引

## 验证与边界

自动化验证协议解码、identity fence、未广告方法、断线、迟到响应防护和会话选择。它不能替代
真实 Gateway 的 transcript、权限拒绝、长内容或 macOS、Windows、CentOS、Ubuntu 真机验收；
本计划不宣称这些环境已经验证。
