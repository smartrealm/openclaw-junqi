# OpenClaw 原生技能提案详情对齐计划

日期：2026-08-03

## 实施顺序

1. 完成：核对官方 schema、Gateway handler、方法权限目录和官方控制台对 agent scope 的绑定。
2. 完成：增加 capability 查询、严格详情 decoder 与只读 inspect RPC，只暴露安全投影。
3. 完成：在既有技能提案清单增加纯文本详情入口，使用同一 scope 并以请求代次隔离过时回包。
4. 完成：补充服务回归、三层记录、索引和历史文档边界说明。
5. 进行中：执行完整 TypeScript、脚本、协作包、生产构建与变更完整性验证后创建中文提交。

## 文件范围

- `src/services/openclawSkillsRuntime.ts`
- `src/services/openclawSkillsRuntime.test.ts`
- `src/pages/SkillsPage/index.tsx`
- `src/pages/SkillsPage/components.tsx`
- `src/locales/{en,zh,zh-TW}.json`
- `docs/quality/`、`specs/quality/`、`plans/quality/` 及索引

## 验证

- `pnpm lint`
- `pnpm test`
- `pnpm verify:openclaw-docs`
- `pnpm collab:test`
- `pnpm collab:validate`
- `OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw pnpm build`
- `git diff --check`、JSON 解析、完整修改文件 Emoji 扫描
