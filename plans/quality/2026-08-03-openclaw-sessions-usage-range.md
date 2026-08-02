# OpenClaw 会话用量范围对齐计划

日期：2026-08-03

## 实施顺序

1. 对照 OpenClaw 官方 Gateway protocol、usage handler 和当前 JunQi Analytics 调用链，确认请求及响应契约。
2. 为 `sessions.usage` 增加官方范围参数构造器和严格响应解析，保留 Gateway 扩展字段。
3. 将 Analytics 的预设和自定义日期映射到官方请求字段，保持全局智能体范围。
4. 补充解码器、请求构造器和预设映射回归测试。
5. 更新审计、规格和索引，记录真实 Gateway 与目标平台未验证边界。

## 文件范围

- `src/stores/gatewayDataStore.ts`
- `src/stores/gatewayDataStore.test.ts`
- `src/pages/FullAnalytics/useAnalyticsData.ts`
- `src/pages/FullAnalytics/useAnalyticsData.test.ts`
- `docs/quality/openclaw-sessions-usage-range-alignment-2026-08-03.md`
- `specs/quality/2026-08-03-openclaw-sessions-usage-range.md`
- `plans/quality/2026-08-03-openclaw-sessions-usage-range.md`
- 对应文档索引和历史审计说明

## 完成判据

请求、响应解析、Analytics 映射、回归测试和文档必须引用 OpenClaw 当前官方契约；真实 Gateway、Windows、CentOS、Ubuntu 和时区组合的验收另行记录，不能由本机 TypeScript 测试代替。
