# OpenClaw Runtime 配置 Schema 信封实施计划

日期：2026-08-09

## 实施顺序

1. 在公共 schema 服务中定义官方响应信封解析，删除把 RPC 返回值直接断言为根 schema 的实现。
2. 将缓存绑定已认证 Gateway 连接 ID，增加连接时序围栏和显式强制重试参数。
3. 更新工具页的加载状态模型，拆分请求失败与工具字段缺失状态，并提供重试操作。
4. 补齐简体中文、繁体中文和英文文案，沿用现有主题 token、按钮与状态样式。
5. 增加公共加载器回归测试，验证协议、缓存和连接切换行为。
6. 更新历史审计结论、文档索引和 `PROJECT_STATUS.md`。
7. 运行定向测试、`pnpm lint`、完整 `pnpm test`、`pnpm build`、`git diff --check` 和 Emoji 扫描。

## 核心文件

- `src/services/openclawConfigSchema.ts`
- `src/services/openclawConfigSchema.test.ts`
- `src/pages/ConfigManager/ToolsTab.tsx`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- `src/locales/en.json`
- `docs/quality/openclaw-config-authority-audit-2026-07-29.md`
- `docs/README.md`
- `specs/README.md`
- `plans/README.md`
- `PROJECT_STATUS.md`

## 验证边界

本轮不修改 OpenClaw 配置写入协议、不重构其他配置标签 UI，也不触碰 `ProvidersTab.tsx` 的用户未提交改动。真实 Gateway
与跨平台桌面视觉验收单独记录，不能由单元测试或前端构建替代。
