# OpenClaw 原生有效工具目录对齐

日期：2026-08-03

## 结论

JunQi 的 Tools 页面现在可以按真实 Session 展示 OpenClaw Gateway 返回的
`tools.effective` 只读快照。该页面同时保留现有的 OpenClaw 配置 schema 编辑器；两者
明确分开：配置编辑器展示可配置字段，有效工具面板展示 Gateway 依据 Session、agent、
渠道、插件和 MCP 策略实际计算出的结果。

JunQi 不在本地计算 allow/deny、profile、插件或 MCP 权限；有效工具读取路径不调用工具，
也不主动连接或列举 MCP 服务。Gateway 未广告该方法、响应不符合官方结构、连接断开或 Session 被删除
时，界面保持不可用或清空旧快照，不用配置字段拼出伪造的权限结果。

## 权威依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw tools schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)
- [OpenClaw tools.effective handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/tools-effective.ts)
- [OpenClaw method descriptors](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)

官方协议将 `tools.effective` 标为 `operator.read`。请求必须包含非空 `sessionKey`，
可选 `agentId`；handler 从 Session key 派生可信的运行时上下文，调用方不能自行指定
认证、投递或渠道上下文。结果包含 `agentId`、`profile`、按 `core`、`plugin`、
`channel`、`mcp` 来源分组的工具，以及可选的 `info`/`warning` notices。工具条目可包含
来源标识、风险等级、标签和 `deniedBySession`；MCP 相关提示由 Gateway 返回。

项目实际安装的 OpenClaw 版本只用于本机复现和验证记录，不作为能力开关或字段契约。
能力是否存在以官方文档、协议 schema、handler、方法目录和当前连接的 advertised
methods 为准。

## 当前行为

1. Tools 页面从 Gateway data store 取得实际 `sessions.list` Session，用户选择一个
   Session 后按需请求 `tools.effective`。
2. 请求通过当前 Gateway 连接发送；显式未广告能力时不会发送 RPC。响应由严格客户端
   校验必需字段、来源、风险、拒绝标记、标签和 notices，未知的附加字段不改变已知语义。
3. 快照按 Session key 和 Gateway 连接绑定，30 秒仅是界面缓存新鲜度边界。请求代次、
   连接身份和 Session 存在性共同决定是否允许写回；迟到响应不能覆盖新连接或已删除
   Session。
4. UI 只读展示 agent、profile、分组、工具标签/ID、Gateway 提供的 notice 和
   `deniedBySession` 标记。它不提供 JunQi 自有的授权开关，不把配置中的 allow/deny
   推断为运行时结果。

## 验证

- `OpenClawToolsEffectiveClient.test.ts` 覆盖请求字段、官方分组/条目/notices、附加字段、
  非法来源/拒绝标记和无效响应。
- `gatewayDataStore.test.ts` 覆盖 Session 删除时快照和加载态清理，以及未广告能力时
  不发送 `tools.effective` RPC。
- 已执行 `pnpm lint` 和 `pnpm exec tsc --noEmit`。

## 未验证边界

- 尚未连接真实 Gateway 现场验证不同 agent、profile 覆盖、渠道插件和 MCP notices 的
  实际数据组合。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机完成 Tools 页面和断线重连验收。
- `tools.catalog` 已由 [OpenClaw 原生工具目录对齐](openclaw-native-tools-catalog-alignment-2026-08-03.md) 单独接入；工具调用由 [OpenClaw 原生工具调用对齐](openclaw-native-tools-invoke-alignment-2026-08-03.md) 单独负责。本次有效工具读取改动不改变工具执行、授权或 MCP 生命周期。
- OpenClaw 官方 schema、handler 或权限目录变化时，必须重新核对源码后更新适配器。
