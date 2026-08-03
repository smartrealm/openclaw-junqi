# OpenClaw 原生 TTS 偏好对齐计划

日期：2026-08-03

## 实施顺序

1. 完成：核对最新官方 Gateway 协议、TTS handler、方法权限目录和 JunQi 现有 TTS status/read 与播放链路。
2. 完成：限定为官方 enabled、provider、persona 写方法，排除 auto、convert、本地音频路径和本地 TTS。
3. 完成：实现带 method advertisement、attested connection fencing、严格确认和状态重读的偏好客户端。
4. 完成：在现有通知设置页接入锁定式控件、多语言状态和回归测试。
5. 完成：更新索引和验证记录，运行全量检查、扫描和中文提交。

## 文件范围

- `src/services/gateway/OpenClawTtsPreferencesClient.ts`
- `src/services/gateway/OpenClawTtsPreferencesClient.test.ts`
- `src/services/gateway/index.ts`
- `src/hooks/useOpenClawTtsStatus.ts`
- `src/components/settings/OpenClawTtsStatusPanel.tsx`
- `src/components/settings/OpenClawTtsStatusPanel.test.tsx`
- `src/pages/SettingsPage.tsx`
- `src/locales/{en,zh,zh-TW}.json`
- `docs/quality/`、`specs/quality/`、`plans/quality/` 及索引

## 验证

- 定向 TTS Gateway client 和设置面板回归
- `pnpm lint`
- `pnpm test`
- `pnpm verify:openclaw-docs`
- `pnpm collab:test`
- `pnpm collab:validate`
- `pnpm build`
- `git diff --check`、JSON 解析、完整修改文件 Emoji 扫描
