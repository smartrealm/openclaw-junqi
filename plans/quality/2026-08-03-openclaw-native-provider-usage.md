# OpenClaw 原生提供方配额对齐计划

日期：2026-08-03

## 实施顺序

1. 完成：核对当前官方 methods descriptor、Gateway protocol、`usage.status` handler、provider usage 类型与缓存作用域。
2. 完成：确定默认 Agent、只读 scope、connection fence、严格窗口校验和敏感字段排除。
3. 完成：实现 Gateway client、状态 Hook、Provider 页面投影与定向回归。
4. 完成：更新索引和验证记录，执行完整检查、扫描和中文提交。

## 文件范围

- `src/services/gateway/OpenClawProviderUsageClient.ts`
- `src/services/gateway/OpenClawProviderUsageClient.test.ts`
- `src/services/gateway/index.ts`
- `src/hooks/useOpenClawProviderUsage.ts`
- `src/components/settings/OpenClawProviderUsagePanel.tsx`
- `src/components/settings/OpenClawProviderUsagePanel.test.tsx`
- `src/pages/ConfigManager/ProvidersTab.tsx`
- `src/locales/{en,zh,zh-TW}.json`
- `docs/quality/`、`specs/quality/`、`plans/quality/` 及索引

## 验证

- 定向 Gateway client 和 Provider 配额面板回归
- `pnpm lint`
- `pnpm test`
- `pnpm verify:openclaw-docs`
- `pnpm collab:test`
- `pnpm collab:validate`
- `pnpm build`
- `git diff --check`、JSON 解析、完整修改文件 Emoji 扫描
