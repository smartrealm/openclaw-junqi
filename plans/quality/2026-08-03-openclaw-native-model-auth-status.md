# OpenClaw 原生模型认证状态对齐计划

日期：2026-08-03

## 实施顺序

1. 完成：核对当前官方 methods descriptor、`models.authStatus` handler/types、广播 scope 与 JunQi Provider 页面。
2. 完成：确定 read-only 安全投影、Gateway 正式错误映射、attested connection fencing 和敏感字段排除。
3. 完成：实现 Gateway client、状态 hook、Provider 页面呈现与定向回归。
4. 完成：更新索引和验证记录，执行完整检查、扫描和中文提交。

## 文件范围

- `src/services/gateway/OpenClawModelAuthStatusClient.ts`
- `src/services/gateway/OpenClawModelAuthStatusClient.test.ts`
- `src/services/gateway/index.ts`
- `src/hooks/useOpenClawModelAuthStatus.ts`
- `src/components/settings/OpenClawModelAuthStatusPanel.tsx`
- `src/components/settings/OpenClawModelAuthStatusPanel.test.tsx`
- `src/pages/ConfigManager/ProvidersTab.tsx`
- `src/locales/{en,zh,zh-TW}.json`
- `docs/quality/`、`specs/quality/`、`plans/quality/` 及索引

## 验证

- 定向 Gateway client 和 Provider 状态面板回归
- `pnpm lint`
- `pnpm test`
- `pnpm verify:openclaw-docs`
- `pnpm collab:test`
- `pnpm collab:validate`
- `pnpm build`
- `git diff --check`、JSON 解析、完整修改文件 Emoji 扫描
