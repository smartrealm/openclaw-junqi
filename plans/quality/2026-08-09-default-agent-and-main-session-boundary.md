# 默认智能体与主会话边界实施计划

## 顺序

1. 核对 OpenClaw `agents.list` schema 与运行时实现，确认 `defaultId`、主会话后缀 `mainKey`、`scope` 和按智能体解析完整主会话 key 的来源。
2. 以解析后的完整默认主会话 key 精确匹配全局固定、关闭、删除和标签投影，不把会话字符串形态当作全局身份。
3. 让新会话和默认智能体展示只使用 `defaultId`；打开其他智能体直聊主会话时，只接受 Gateway 已返回且会话后缀匹配的 key。
4. 覆盖自定义主会话后缀、其他智能体直聊主会话删除和未返回会话不创建本地页签的回归场景。
5. 运行定向测试、静态检查、完整测试、生产构建和差异检查；回写审计、规格与项目状态。

## 核心文件

- `src/utils/sessionLifecycle.ts`
- `src/utils/sessionDelete.ts`
- `src/utils/sessionLabel.ts`
- `src/stores/chatStore.ts`
- `src/components/Chat/ChatTabs.tsx`
- `src/pages/SessionManager.tsx`
- `src/pages/Dashboard/index.tsx`
- `src/pages/AgentHub/index.tsx`
