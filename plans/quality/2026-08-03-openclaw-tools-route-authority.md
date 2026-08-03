# OpenClaw 工具入口权威对齐计划

日期：2026-08-03

## 实施顺序

1. 完成：核对旧工具页、用户入口、现有原生工具页和 OpenClaw MCP App/工具协议。
2. 完成：记录虚假工具目录与 MCP 占位边界，确定旧深链迁移目标。
3. 完成：删除旧页面和翻译占位，更新路由、侧栏、会话入口与导航回归。
4. 完成：执行定向与全量验证，更新记录并创建中文提交。

## 文件范围

- `src/AppRouteTree.tsx`
- `src/pages/McpTools.tsx`
- `src/components/Layout/{NavSidebar,NavSidebarPanels}.tsx`
- `src/components/Chat/SessionContextBar.tsx`
- `src/locales/{en,zh,zh-TW}.json` 及导航测试
- `docs/`、`specs/`、`plans/` 相关索引与设计记录

## 验证

- 路由与导航定向回归
- `pnpm lint`
- `pnpm test`
- `pnpm verify:openclaw-docs`
- `pnpm collab:test`
- `pnpm collab:validate`
- `OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw pnpm build`
- `git diff --check`、JSON 解析、完整修改文件 Emoji 扫描
