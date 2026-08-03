# OpenClaw 原生技能提案事件对齐计划

日期：2026-08-03

## 实施顺序

1. 完成：核对最新官方 events schema、Gateway handler、权限目录、Skill Workshop 文档与 JunQi 的
   proposal list/inspect scope 链路。
2. 完成：定义安全字段投影、分页、竞态隔离、管理员写操作排除与跨平台边界。
3. 完成：实现 Gateway runtime decoder、capability、只读分页 RPC 和 proposal UI 事件对话框。
4. 完成：补充回归测试、三层索引和历史边界记录，执行全量验证并创建中文提交。

## 文件范围

- `src/services/openclawSkillsRuntime.ts`
- `src/services/openclawSkillsRuntime.test.ts`
- `src/pages/SkillsPage/index.tsx`
- `src/pages/SkillsPage/components.tsx`
- `src/locales/{en,zh,zh-TW}.json`
- `docs/quality/`、`specs/quality/`、`plans/quality/` 与索引

## 验证

- 定向 service 回归
- `pnpm lint`
- `pnpm test`
- `pnpm verify:openclaw-docs`
- `pnpm collab:test`
- `pnpm collab:validate`
- `OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw pnpm build`
- `git diff --check`、JSON 解析、完整修改文件 Emoji 扫描
