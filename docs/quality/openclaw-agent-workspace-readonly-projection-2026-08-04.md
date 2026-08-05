# OpenClaw Agent 工作区只读投影

日期：2026-08-04

## 依据

- OpenClaw 官方协议文档 `docs/gateway/protocol.md`：`agents.workspace.list` 与 `agents.workspace.get` 是 `operator.read` 的只读接口；请求仅接受工作区相对路径，Gateway 负责真实路径约束、容量限制和文本或常见图片读取。
- OpenClaw 官方 schema `packages/gateway-protocol/src/schema/agents-workspace.ts`：目录结果由 `agentId`、相对 `path`、可选 `parentPath`、分页信息和条目组成；文件结果仅提供 UTF-8 或 base64 内容。
- OpenClaw 官方 Gateway 实现 `src/gateway/server-methods/agents-workspace.ts`：Gateway 不向客户端暴露工作区主机路径，拒绝绝对路径及逃逸路径，并且该命名空间不存在写入、删除或上传操作。
- JunQi `src/services/gateway/Connection.ts`：已提供认证连接身份与 `requestFenced`，可将异步读结果绑定到发起请求的 Gateway 连接。

## 当前行为

Agent Hub 原有的工作区面板直接使用 Tauri 本机文件系统能力，并可编辑、重命名和删除文件。它还接收 Agent 配置中的本机目录字符串。该做法无法适配远程、Docker 或其他平台上的 Gateway 工作区，也违反官方只读协议的路径边界。

## 目标行为

- Agent Hub 仅通过 `agents.workspace.list/get` 浏览当前已认证 Gateway 所解析的指定 Agent 工作区。
- 所有投影请求只携带 `agentId` 与 Gateway 返回或界面生成的相对路径；只读投影不发送、显示或推导主机工作区绝对路径。
- 使用连接身份围栏。Gateway 断开、连接切换、方法缺失或无权限时显示不可用状态，不回退到本机目录。
- 仅显示官方协议允许的 UTF-8 文本与图片内容；没有编辑器、系统打开、重命名、删除、上传或其他变更入口。
- 保留独立的本机文件管理功能及其 IPC 契约，本次不改变其权限或运行时边界。

## 验证与边界

- Gateway 客户端测试覆盖参数边界、严格响应解析、缺失方法、断开连接和过期连接响应。
- Agent Hub 测试覆盖只读面板替换及不再传递本机路径。
- 已通过定向 Gateway、Agent Hub、文件管理回归测试，以及 `pnpm lint`、`pnpm test`、`pnpm test:rust`、`pnpm build`、`pnpm verify:openclaw-docs` 和 `git diff --check`。
- 尚未针对真实 Gateway、macOS、Windows、CentOS 或 Ubuntu 完成真机验证；自动化验证不能替代这些平台和运行时组合的验收。
