# Agent Workspace 能力权威性收敛计划

日期：2026-08-04

1. [x] 对照当前页面、持久化模型和 OpenClaw 官方 workspace 协议，区分真实本机功能与未接入占位入口。
2. [x] 收敛 domain、store 与页面的标签和右侧面板类型，删除无支持渲染分支。
3. [x] 将 Workbench session schema 升级并实现结构化旧快照迁移。
4. [x] 补充页面、schema、store/persistence 回归测试。
5. [x] 执行定向和全量验证，检查遗留引用、Emoji 与差异；以中文提交。

## 文件范围

- `src/pages/AgentWorkspace/index.tsx`
- `src/pages/AgentWorkspace/index.test.ts`
- `src/pages/AgentWorkspace/workbench.css`
- `src/workbench/domain/types.ts`
- `src/workbench/store/workbenchStore.ts`
- `src/workbench/session/schema.ts`
- `src/workbench/session/schema.test.ts`
- `src/workbench/session/writer.test.ts`
- `docs/README.md`、`specs/README.md`、`plans/README.md`
