# 设置页面多语言完整性计划

日期：2026-07-30

## 实施

- [x] 扫描设置主页面和全部设置子组件的翻译键。
- [x] 复现扁平键和缺失键问题。
- [x] 增加静态键与动态键完整性测试。
- [x] 补齐 `zh`、`zh-TW` 和 `en` 目录。
- [x] 移除本次范围内的源码默认文案和重复标签常量。
- [x] 运行定向测试、lint、完整测试、生产构建和差异检查。
- [ ] 在三种语言下完成桌面端逐页视觉检查。

## 文件范围

- `src/pages/SettingsPage.tsx`
- `src/components/settings/`
- `src/components/Terminal/terminalStatusPreferences.ts`
- `src/pet/skins/index.tsx`
- `src/locales/`
- `docs/quality/`、`specs/quality/`、`plans/quality/`
