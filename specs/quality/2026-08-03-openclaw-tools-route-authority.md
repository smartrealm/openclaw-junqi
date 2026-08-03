# OpenClaw 工具入口权威对齐规格

日期：2026-08-03

## 目标

移除 JunQi 对 MCP 和可用工具的硬编码推断，使原 `/tools` 入口只通向已有的 OpenClaw 原生工具目录页面。

## 契约

1. `/tools` 必须 replace 跳转至 `/config?tab=tools`，不得再挂载硬编码工具或 MCP 占位页面。
2. 所有可见工具入口必须使用 OpenClaw 工具的准确文案并指向同一原生工具页。
3. 客户端不得根据渲染块、固定工具名称、会话历史或本机条件推断 Gateway 可用工具。
4. 本项不得调用 `mcp.app.*`，不得创建 MCP server、transport、连接、凭据、工具或 App view。
5. 真实工具目录、有效工具和显式调用继续由既有 `tools.catalog`、`tools.effective`、`tools.invoke`
   Gateway clients 负责，保持相应的能力广告与确认门禁。

## 非目标

- 不接入 MCP App HTML 渲染、资源读取或 App 工具调用。
- 不改写 OpenClaw config、工具策略、agent/session scope 或工具调用生命周期。
- 不移除 `/tools` 兼容深链。

## 验收

1. 代码库不再包含 `McpToolsPage`、固定工具目录或 MCP “即将上线”文本。
2. `/tools` 路由与所有导航入口指向官方工具页。
3. 回归、静态检查、全量验证和文档检查通过，真机边界明确记录。
