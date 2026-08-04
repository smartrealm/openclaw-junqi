# OpenClaw Agent 引导文件只读投影

日期：2026-08-04

## 依据

- OpenClaw 官方协议 schema `packages/gateway-protocol/src/schema/agents-models-skills.ts`：`agents.files.list/get` 按 Agent 返回可编辑引导文件元数据和内容；`agents.files.set` 是独立的 `operator.admin` 写入方法。
- OpenClaw 官方 Gateway handler `src/gateway/server-methods/agents.ts`：文件名由 `WORKSPACE_BOOTSTRAP_FILENAMES` 白名单限制，Gateway 安全读取工作区根目录；列表或读取结果包含工作区和文件路径，但这些路径不应被客户端再次作为访问依据。
- OpenClaw 官方方法描述 `src/gateway/methods/core-descriptors.ts`：list/get 为 `operator.read`，set 为 `operator.admin`。
- OpenClaw 官方文档 `docs/help/faq.md`：`AGENTS.md`、`SOUL.md`、`IDENTITY.md`、`USER.md`、`MEMORY.md` 与首次引导文件属于 Agent 工作区上下文。

## 当前行为

JunQi 能配置 Agent 工作区并浏览通用工作区内容，但无法直接核对 Gateway 当前公开的引导文件清单。若将通用工作区编辑器复用于这些文件，会绕过 Gateway 对文件名白名单及权限边界。

## 目标行为

- Agent 设置面板只读显示 Gateway 的 `agents.files.list/get` 结果，按官方返回文件名读取内容。
- 客户端严格核对 Agent 身份、文件名、缺失状态、可选元数据和内容类型，丢弃 `workspace` 与文件 `path` 字段，不向界面暴露主机路径。
- 每个读取请求在发出前和完成后验证认证 Gateway 连接身份；连接切换、断开、方法缺失或权限失败均不产生本机回退。
- 仅以文本预览呈现实际返回内容；`expectedAbsent` 文件显示为正常可选状态，而不是读取错误。
- 不接入 `agents.files.set`。当前官方 schema 没有 CAS 版本、内容哈希或幂等键，JunQi 不伪造并发写入保障。

## 验证与边界

- 客户端回归测试覆盖官方请求、路径字段丢弃、响应错配、缺失方法、断开和过期连接。
- Agent 设置面板回归测试覆盖只读投影、缺失文件状态和无写入入口。
- 已通过 `pnpm lint`、`pnpm test`、`pnpm test:rust`、`pnpm build`、`pnpm verify:openclaw-docs` 和 `git diff --check`。
- 真实 Gateway 以及 macOS、Windows、CentOS、Ubuntu 的目标环境验收仍待执行。
