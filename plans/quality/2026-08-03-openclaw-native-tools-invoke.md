# OpenClaw 原生工具调用对齐计划

日期：2026-08-03

## 实施顺序

1. 核对官方 `tools.invoke` schema、`operator.write` 权限、handler 的 Session/agent
   解析、审批模式和方法广告。
2. 新增严格的 `OpenClawToolsInvokeClient`，只接受官方请求和结果字段，不合成 output、
   error 或 approval 状态。
3. 在 Gateway data store 中增加当前连接、运行时身份、Session 和 `tools.effective`
   门禁；副作用调用不自动重试，幂等键只透传。
4. 在 Config Manager Tools 页面提供动态工具选择、JSON object 参数、显式 confirm 和
   结果/审批/错误展示；不把调用结果写入聊天或 JunQi Task 图。
5. 更新三层文档和多语言文案，执行目标测试、lint、完整测试、构建、官方链接、差异和
   无 Emoji 检查，使用中文 commit。

## 文件范围

- `src/services/gateway/OpenClawToolsInvokeClient.ts`
- `src/services/gateway/OpenClawToolsInvokeClient.test.ts`
- `src/stores/gatewayDataStore.ts`
- `src/stores/gatewayDataStore.test.ts`
- `src/pages/ConfigManager/ToolsTab.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 `docs/`、`specs/`、`plans/` 索引和全局能力拓展计划

## 不做的事情

- 不本地执行工具策略、审批或 MCP 生命周期。
- 不伪造 `tools.invoke` 的 runId、tool message、transcript、Task 节点或成功状态。
- 不将安装版本写成能力开关，不在未广告或未验证连接时发送 RPC。
- 不自动重试副作用工具；真实 Gateway 和目标平台现场验证前不宣称跨平台完成。
