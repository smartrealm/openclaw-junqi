# OpenClaw 原生工具目录对齐

日期：2026-08-03

## 结论

JunQi 的 Tools 页面现在通过 OpenClaw 原生 `tools.catalog` 展示指定 agent 的全局
core/plugin 工具目录。这个目录用于观察配置可见的工具、工具 profile、插件归属、风险、
可选标记和默认 profile；它不是某个 Session 的最终权限。Session 级实际结果仍由旁边的
`tools.effective` 面板负责。

JunQi 不维护第二份工具目录，不根据配置字段本地合成插件工具；目录读取路径本身不执行
`tools.invoke`，也不主动连接 MCP。Gateway 未广告该方法、返回不合法数据、agent 被删除或连接断开时，
界面不保留旧目录作为当前事实。

## 权威依据

- [OpenClaw Gateway protocol: Operator helper methods](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md#operator-helper-methods)
- [OpenClaw tools schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)
- [OpenClaw tools.catalog handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/tools-catalog.ts)
- [OpenClaw method descriptors](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)

官方协议将 `tools.catalog` 标为 `operator.read`，请求参数为可选 `agentId` 和
`includePlugins`。结果包含 `agentId`、四种官方 profile、core/plugin 分组和工具条目。
工具条目包括 `id`、`label`、`description`、来源、可选的插件归属、optional、risk、tags
和必需的 `defaultProfiles`；插件目录由 Gateway 按其运行时插件注册表生成。

项目实际安装的 OpenClaw 版本只用于本机复现，不作为能力开关。能力是否存在以官方文档、
schema、handler、方法目录和当前连接的 advertised methods 为准。

## 当前行为

1. Tools 页面从 Gateway data store 使用真实 `agents.list` 结果选择 agent，并按需请求
   `tools.catalog`，显式请求 `includePlugins: true` 以展示官方允许展示的插件目录。
2. 客户端严格验证 profile、分组、工具来源、风险、tags、optional 和 default profile；
   不把缺失字段补成默认工具或默认 profile。
3. 目录快照按 agent 和 Gateway 连接绑定，30 秒只是 UI 缓存新鲜度边界。请求代次、连接
   身份和 agent 存在性共同决定是否允许写回；迟到响应不能污染新连接或已删除 agent。
4. 面板只读展示目录元数据。配置 schema 编辑器仍是配置入口，`tools.effective` 仍是
   Session 级运行时结果，两者不互相推断。

## 验证

- `OpenClawToolsCatalogClient.test.ts` 覆盖请求字段、profile、core/plugin 分组、工具
  元数据、附加字段和非法响应。
- `gatewayDataStore.test.ts` 覆盖 agent 生命周期、未广告能力和不发送不受支持的 RPC。
- 已执行目标 TypeScript 测试、`pnpm lint`、完整测试、生产构建、官方链接和差异检查。

## 未验证边界

- 尚未连接真实 Gateway 现场验证插件 registry、optional 工具和 profile 的实际组合。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机完成 Tools 页面和断线重连验收。
- `tools.invoke` 由独立的 [OpenClaw 原生工具调用对齐](openclaw-native-tools-invoke-alignment-2026-08-03.md)
  记录负责；本次目录读取改动不改变工具执行、审批、授权或 MCP 生命周期。
