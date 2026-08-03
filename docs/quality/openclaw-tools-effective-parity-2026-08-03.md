# OpenClaw tools.effective 能力对齐

## 依据

- 本机安装版本：`OpenClaw 2026.7.1-2 (0790d9f)`。
- 官方随包 `dist/schema-BuOFpc7K.js`：`ToolsEffectiveParamsSchema` 要求 `sessionKey`，`agentId` 可选；`ToolsEffectiveResultSchema` 返回 `agentId`、`profile`、`groups` 和可选 `notices`。
- 官方随包 `dist/tools-effective-DNs36xaT.js`：Gateway 会依据真实会话、模型、渠道、插件和 MCP 运行时计算实际工具集；未知会话或 Agent 不会静默返回空列表。
- 官方控制台实现：在 Agent 工具面板请求 `tools.effective`，而不是把配置中的工具字段当成实际可用工具。

## 当前行为

JunQi 原来只有 ConfigManager 的 `tools` 配置编辑入口。它能表达配置内容，但无法回答当前会话经过 profile、渠道、插件和运行时过滤后到底能调用哪些工具。

## 目标行为

聊天上下文栏的工具图标打开一个只读面板：

1. 使用当前真实 `sessionKey` 和解析出的 Agent ID 请求 `tools.effective`。
2. 只展示 Gateway 返回的实际工具，按 `core`、`plugin`、`channel`、`mcp` 分组。
3. 展示 Gateway 返回的 profile、风险标记和过滤提示。
4. 严格校验请求与响应字段。协议异常、未知会话和连接错误必须显示错误并允许重试，不将异常降级为空工具集。
5. 保留“打开工具配置”入口，但明确配置视图与运行时实际工具是两个不同来源。

## 实现

- `src/services/gateway/toolsEffective.ts`：构造请求参数并严格解析官方返回结构。
- `src/services/gateway/index.ts`：增加 `gateway.getEffectiveTools` 只读出口。
- `src/hooks/useEffectiveTools.ts`：按会话和 Agent 管理请求生命周期，阻止旧会话响应覆盖新会话。
- `src/components/Chat/EffectiveToolsControl.tsx`：在会话上下文栏展示只读实际工具面板。
- `src/components/Chat/SessionContextBar.tsx`：接入当前会话入口。

## 验证

- `toolsEffective.test.ts` 覆盖官方请求 envelope、分组与 notice 解析、严格字段失败。
- `MessageInput.composer.test.ts` 覆盖上下文栏入口、只读面板和请求生命周期标记。
- 已核对本机 OpenClaw 版本的 schema、handler 和控制台调用方式。

## 未验证边界

- 当前主机是 macOS，未在真实 Gateway 会话中执行 `tools.effective` 并取得线上响应样本。
- MCP 工具是否已完成当前会话发现由 Gateway 运行时决定；JunQi 只展示官方返回的 notice，不自行补齐工具。
- 未接入 `tools.invoke`，因为它是有外部效果的操作，不属于本次只读能力对齐范围。
