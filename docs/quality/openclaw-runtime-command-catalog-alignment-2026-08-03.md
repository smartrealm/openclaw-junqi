# OpenClaw 运行时命令目录对齐

日期：2026-08-03

## 审计结论

JunQi 原有 `/openclaw-commands` 页面把 55 条 CLI 示例、分类、参数模板和影响等级写入客户端；聊天输入框另有一份
斜杠命令、静态参数补全和本地拦截表。这两份目录无法反映当前 Gateway 的 agent、已启用技能、插件、渠道 provider
或命令作用域，且把 CLI 文档示例错误地呈现成了当前桌面会话可用的命令。

最新版 OpenClaw 提供官方 `commands.list` Gateway 方法。它按解析后的 agent、可选 provider、scope 与
`includeArgs` 返回 bounded command entries，并将原生命令、技能命令和插件命令统一标记为 `native`、`skill` 或
`plugin`。Gateway 负责每项命令是否出现、别名、参数 choices 和动态参数标志；JunQi 只呈现其已验证结果。

## 权威依据

- [OpenClaw commands.list handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/commands.ts)
- [OpenClaw commands.list result builder](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/commands-list-result.ts)
- [OpenClaw Gateway command protocol schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/commands.ts)
- [OpenClaw Gateway protocol operator helper methods](https://docs.openclaw.ai/gateway/protocol)

官方 schema 定义 `commands.list` 为 `operator.read`。请求只允许可选 `agentId`、`provider`、`scope` 与
`includeArgs`；响应的 source、scope、category、argument type 与静态 choices 都是有限枚举。缺失方法、连接变化、
无效字段或无效 agent 都不能由客户端补默认命令。

## 目标实现

- 新增受已认证 Gateway connection fence 保护的 `commands.list` client；方法发现遗漏不会阻止请求，实际 Gateway 响应决定结果。
- `/openclaw-commands` 展示当前 Gateway 返回的运行时命令，不执行、安装、配置或拼接任何 CLI 命令。
- 聊天输入框按当前 session key 中的 agent ID 请求真实的 text-scope 命令；参数补全只使用 Gateway 返回的静态
  choices。动态参数保留为 Gateway 标记，JunQi 不猜测候选值。
- 从命令选择器删除 JunQi 拦截的会话重置、新建会话和模型目录捷径，避免同一命令在客户端与 Gateway 有不同语义。
- 删除静态 CLI 清单、固定类别和计数，以及将外部 CLI 文档当作运行时能力来源的页面文案。

## 非目标与边界

- 不调用 `chat.send`、`chat.inject`、`config.*`、`tools.*` 或任何 privileged RPC 来加载命令目录。
- 不把 `commands.list` 当作 CLI 命令、插件安装清单、模型目录、工具权限或 Gateway 健康检查。
- 不从 session key 构造不存在的 agent。无法从 key 验证 agent ID 时，目录请求省略 `agentId`，由 Gateway 解析其
  默认 agent；响应中的真实目录仍是唯一呈现依据。
- Gateway 返回未知方法、断线、响应无效或指定 agent 被拒绝时显示不可用或失败状态，不保留旧 catalog，不回退到
  写死命令，也不要求浏览器或系统 shell。

## 验证结果

- `OpenClawCommandsClient` 与 Composer 领域回归覆盖请求字段、能力门禁、连接围栏、协议解析、当前参数位的
  Gateway choices、动态参数不猜测及无本地命令拦截。
- `pnpm lint` 与 `pnpm test` 已通过。
- `pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate`、`pnpm build` 与生产 Vite 构建已通过。
- 三份语言 JSON 可解析，`git diff --check` 通过；静态命令模块、固定目录与旧侧栏计数均已移除，25 个新增或
  修改文件未检出 Emoji。

## 未验证边界

- 当前工作区没有可用于验收的真实 Gateway，尚未在不同 agent、插件、技能、provider 和权限角色下验证现场目录。
- 尚未在 macOS、Windows、CentOS、Ubuntu 的 Tauri 安装包中验证命令目录、输入补全与断线恢复的交互表现。
