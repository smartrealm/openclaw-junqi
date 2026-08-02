# OpenClaw 原生工具目录对齐规格

日期：2026-08-03

## 目标

Tools 页面以 OpenClaw Gateway 为权威，展示指定 agent 的全局 core/plugin 工具目录，并
与指定 Session 的 `tools.effective` 运行时结果保持清晰的数据边界。

## 约束

1. 只能调用官方 `tools.catalog`，权限为 `operator.read`；agent ID 必须来自 Gateway
   的真实 `agents.list`，不能生成默认 agent 或从 Session key 猜测 agent。
2. 请求只透传官方可选 `agentId` 和 `includePlugins`；插件注册、冲突处理、workspace、
   profile 和默认工具由 Gateway handler 决定。
3. 响应必须满足官方 agent、profile、group 和 tool 结构；未知来源、风险、profile、
   optional 或 tags 类型错误时不得进入 UI 状态。
4. 目录缓存必须绑定 Gateway 连接和 agent。新的请求代次、断线或 agent 删除后，旧目录
   不得继续显示为当前结果。
5. catalog 是全局目录，effective 是 Session 级结果；JunQi 不得从 catalog 推断实际
   Session 权限，也不得从 effective 反写配置。
6. 自动化验证和本机 build 不能替代真实 Gateway、Windows、macOS、CentOS、Ubuntu 的
   现场验收。

## 验收条件

- Gateway 广告能力且返回合法结果时，用户可选择真实 agent，看到 profiles、core/plugin
  分组、工具 ID/标签、风险、optional、tags 和 default profiles。
- Gateway 未广告、响应非法、连接失败或 agent 被删除时，不发送不受支持的 RPC、不显示
  旧目录，并呈现明确不可用或失败状态。
- 切换 agent、刷新和重连不会让迟到响应写入当前目录；Session 级有效工具面板继续独立
  使用 `tools.effective`。
- 文档、测试和未验证边界与实际代码状态同步。
