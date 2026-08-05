# OpenClaw 原生 TTS 状态对齐计划

日期：2026-08-03

## 实施顺序

1. 完成：核对最新 TTS handler、方法权限、auto mode 类型、现有 TTS client、VoiceRuntime 与设置页。
2. 完成：确定只读安全投影、connection identity fencing、配置写操作排除和跨平台边界。
3. 完成：实现 strict TTS status client、设置状态 hook 与只读呈现。
4. 完成：补充回归测试、索引与历史边界，执行全量验证并创建中文提交。

## 文件范围

- `src/services/gateway/`
- `src/hooks/`
- `src/components/settings/`
- `src/pages/SettingsPage.tsx`
- `src/locales/{en,zh,zh-TW}.json`
- `docs/quality/`、`specs/quality/`、`plans/quality/` 及索引

## 验证

- 定向 Gateway client、hook/component 回归
- `pnpm lint`
- `pnpm test`
- `pnpm verify:openclaw-docs`
- `pnpm collab:test`
- `pnpm collab:validate`
- `OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw pnpm build`
- `git diff --check`、JSON 解析、完整修改文件 Emoji 扫描
