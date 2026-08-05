# OpenClaw 工具入口权威对齐

日期：2026-08-03

## 审计结论

旧 `/tools` 页面把当前会话中观察到的渲染块与一份硬编码工具清单拼接为“可用工具”，并展示“即将上线”的
全局 MCP 集成。该结果既不等于 OpenClaw 为 agent 配置的工具目录，也不等于指定 session 的实际有效工具；
它还承诺了 OpenClaw 没有定义的 JunQi 自有 MCP 连接与管理能力。

最新版 OpenClaw 已提供 `tools.catalog`、`tools.effective` 和 `tools.invoke`，JunQi 的配置管理工具页已按
这些官方方法呈现。`mcp.app.*` 只服务于一个已创建、具备 `sessionKey` 和 `viewId` 的 MCP App view，不能作为
全局 MCP 服务器目录或连接管理协议。

## 权威依据

- [OpenClaw tools.catalog handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/tools-catalog.ts)
- [OpenClaw tools.effective handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/tools-effective.ts)
- [OpenClaw tools.invoke handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/tools-invoke.ts)
- [OpenClaw MCP App Gateway handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/mcp-app.ts)
- [OpenClaw MCP Apps security boundary](https://github.com/openclaw/openclaw/blob/main/docs/cli/mcp.md)

官方方法目录将 `tools.catalog` 与 `tools.effective` 标为 `operator.read`，将 `tools.invoke` 标为
`operator.write`。`mcp.app.*` 是已建立 App view 的受限读取或交互通道；其 handler 明确要求非空 session key
和 view id，并依赖 Gateway 的有效 view lease 与工具策略。

## 当前实现

- 删除硬编码工具清单、客户端统计推断和 MCP 占位承诺。
- 保留 `/tools` 作为兼容深链，但以 replace 重定向到 `/config?tab=tools`。
- 侧栏和会话上下文入口统一使用“OpenClaw 工具”名称并直接进入现有原生工具页。
- 配置管理工具页继续使用既有的官方 `tools.catalog`、`tools.effective` 与受确认保护的 `tools.invoke`
  实现；本项不改写其 Gateway、agent、session、权限或副作用边界。
- 不调用 `mcp.app.*`，不渲染 Gateway App HTML，不创建 MCP transport、server、连接、凭据或 JunQi 私有
  工具目录。

## 兼容与跨平台边界

`/tools` 的旧书签会进入桌面配置管理的工具标签。导航不依赖 macOS、Windows、CentOS 或 Ubuntu 的系统路径、
浏览器特征或本机 OpenClaw 安装位置。真实 Gateway 对工具目录、有效策略和调用确认的授权仍需目标平台实测。

## 验证结果

- 定向回归通过，验证旧入口目标为 `/config?tab=tools`、工具标签可解析，以及三语工具入口文案。
- `pnpm lint`、`pnpm test`、`pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate` 通过。
- `OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw pnpm build` 成功结束；生产入口与构建资源存在。
- JSON 解析、`git diff --check` 与完整修改文件 Emoji 扫描通过。

## 未验证边界

- 当前工作区未连接真实 Gateway，未验证 `tools.catalog`、`tools.effective`、`tools.invoke` 和 MCP App
  view 的现场权限与过期行为。
- 未在 macOS、Windows、CentOS、Ubuntu 的 Tauri 安装包验证旧深链迁移和工具页视觉交互。
