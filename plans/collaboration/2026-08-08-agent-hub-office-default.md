# 智能体中心默认办公室投影实施计划

日期：2026-08-08

## 依据

- `src/components/Collaboration/AgentOfficeView.tsx` 和 `src/services/collaboration/agentOfficeProjection.ts` 已定义只读 Office 投影。
- `src/stores/collaborationStore.ts` 已拥有 `bootstrap`、`syncGlobalRuns`、`refreshRun` 和运行时身份围栏。
- `src/components/Collaboration/CollaborationActivityRuntime.tsx` 已在应用路由根部维护全局协作投影。

## 步骤

1. 抽取智能体中心的 Run 选择纯函数，稳定决定最近未归档 Run 与保留用户选择的条件。
2. 新增页面级 Office 工作区，只依赖协作 store 和现有 Office 展示组件；配置员工席位始终存在，真实 Run 快照作为运行覆盖层，并处理加载、断连、无 Run、错误、刷新、选择和详情导航。
3. 将 `AgentHub` 默认视图切换为 Office，保留树状、网格和活动入口。
4. 补齐三种语言文案与页面交互测试；执行 TypeScript、定向测试、边界检查和 Emoji 扫描。
5. 更新设计验证记录和 `PROJECT_STATUS.md`，明确未完成的真机视觉验证范围。

## 文件范围

- `src/pages/AgentHub/index.tsx`
- `src/pages/AgentHub/AgentHubOfficePanel.tsx`
- `src/pages/AgentHub/agentHubOfficeRunSelection.ts`
- 对应定向测试与三份 locale JSON
- `docs/`、`specs/`、`plans/` 索引及验证记录
