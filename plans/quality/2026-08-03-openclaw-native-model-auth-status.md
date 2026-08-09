# OpenClaw 原生模型认证状态对齐计划

日期：2026-08-03

## 实施顺序

1. 完成：核对当前官方 methods descriptor、`models.authStatus`/`models.authLogout` handler/types、Gateway 协议与 JunQi Provider 页面。
2. 完成：确定只读安全投影、Gateway 正式错误映射、attested connection fencing 和敏感字段排除。
3. 完成：实现 Gateway client、状态 hook、Provider 页面呈现与定向回归。
4. 完成：仅按官方 `logoutSupported` 能力增加 Provider 级注销确认，通过临时 `operator.admin` 调用 `models.authLogout` 并刷新状态。
5. 完成：增加用户确认后的官方 `models.probe` 实时验证，限制安全投影并在认证快照变化时清除旧结果。
6. 完成：将认证健康收敛到 Provider 卡片，删除独立面板和重复信息，更新验证记录并执行完整检查与扫描。
7. 完成：区分首次快照读取与用户触发的强制刷新，令后者传递官方 `models.authStatus.refresh` 参数并补回归测试。

## 文件范围

- `src/services/gateway/OpenClawModelAuthStatusClient.ts`
- `src/services/gateway/OpenClawModelAuthStatusClient.test.ts`
- `src/services/gateway/OpenClawModelAuthLogoutClient.ts`
- `src/services/gateway/OpenClawModelAuthLogoutClient.test.ts`
- `src/services/gateway/OpenClawModelProbeClient.ts`
- `src/services/gateway/OpenClawModelProbeClient.test.ts`
- `src/services/gateway/index.ts`
- `src/hooks/useOpenClawModelAuthStatus.ts`
- `src/pages/ConfigManager/ProvidersTab.tsx`
- `src/pages/ConfigManager/ProvidersTab.modelAuthStatus.test.tsx`
- `src/locales/{en,zh,zh-TW}.json`
- `docs/quality/`、`specs/quality/`、`plans/quality/` 及索引

## 验证

- 定向 Gateway client 和 Provider 卡片认证摘要回归
- `pnpm lint`
- `pnpm test`
- `pnpm verify:openclaw-docs`
- `pnpm collab:test`
- `pnpm collab:validate`
- `pnpm build`
- `git diff --check`、JSON 解析、完整修改文件 Emoji 扫描
