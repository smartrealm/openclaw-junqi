# Agent canonical main session projection 实施计划

## 实施项

- [x] 核对 OpenClaw 2026.7.1-2 的 Agent main session key 和 JunQi AgentHub/ChatTabs
  分类链路。
- [x] 在共享 session presentation 层增加 canonical main 分类和按 Agent 查找函数。
- [x] 修正 AgentHub 普通会话误标 main、列表顺序决定 main 的问题。
- [x] 修正 ChatTabs 只保护 `agent:main:main` 的问题。
- [x] 增加纯函数回归测试并同步 alignment/roadmap 记录。
- [ ] 真实多 Agent Gateway 和 reset 后 UI 手工验收。

## 验证顺序

1. `sessionPresentation` 相关测试和 TypeScript 类型检查。
2. `pnpm lint`、前端完整测试和生产构建。
3. 记录真实 Gateway/目标平台未验证边界，不把自动化结果描述为手工验收。
