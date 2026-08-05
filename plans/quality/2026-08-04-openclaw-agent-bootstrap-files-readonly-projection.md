# OpenClaw Agent 引导文件只读投影计划

日期：2026-08-04

1. [x] 核对官方 schema、Gateway handler、方法权限和当前 Agent Hub 代码。
2. [x] 新增连接围栏的 `agents.files.list/get` 客户端和回归测试。
3. [x] 在 Agent 设置中接入只读引导文件列表及文本预览，不接入写入。
4. [x] 更新多语言、索引和验证记录，运行定向及全量检查并中文提交。

## 文件范围

- `src/services/gateway/OpenClawAgentFilesClient.ts`
- `src/services/gateway/OpenClawAgentFilesClient.test.ts`
- `src/services/gateway/index.ts`
- `src/pages/AgentHub/index.tsx`
- `src/pages/AgentHub/AgentSettingsPanel.tsx`
- `src/pages/AgentHub/AgentSettingsPanel.interaction.test.ts`
- `src/locales/en.json`、`src/locales/zh.json`、`src/locales/zh-TW.json`
- `docs/README.md`、`specs/README.md`、`plans/README.md`
