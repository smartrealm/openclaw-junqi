# OpenClaw 会话 Agent Runtime 投影对齐

## 权威依据

最新 [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol) 将 `sessions.list[].agentRuntime` 定义为配置 runtime backend 时的会话行元数据，并规定 `sessions.patch` 回传解析后的有效 runtime。[官方共享会话类型](https://github.com/openclaw/openclaw/blob/main/src/shared/session-types.ts) 约束该对象的 `id` 为非空字符串；其他字段属于可选元数据。

## 发现

JunQi 已读取 Gateway 返回的模型、思考和多个会话覆盖，但没有保留已确认的 runtime id。模型显示的是选择的模型引用，不必然说明哪个 OpenClaw backend 实际承接执行；丢弃 runtime 会让状态卡缺少 Gateway 已提供的事实。

## 实现边界

- 只投影有效的 `agentRuntime.id`，没有本地默认值、provider/model 正则或 runtime 白名单。
- `sessions.list` 是会话投影权威。列表行缺失该字段时清除旧投影，避免连接或模型切换后显示陈旧 runtime。
- 已确认的模型 patch 回执若携带有效 runtime，立即更新同一目标会话；字段缺失时保留现值，等待既有 `sessions.changed` 驱动的权威刷新。
- Agent 状态卡只读展示 Gateway runtime id，不提供配置、兼容性承诺、自动修复或 fallback。

## 验证结果

- 定向回归通过：runtime 解析、会话状态隔离、模型回执、会话存储共 49 项测试通过。
- `pnpm lint` 通过，包含 TypeScript 与模块边界检查。
- `pnpm build` 通过，包含协作插件包契约校验、TypeScript 与 Vite 生产构建。

## 未验证边界

真实 Gateway 的不同 runtime backend、模型切换、事件刷新及 macOS、Windows、CentOS、Ubuntu 窄窗口仍需目标环境验收。JunQi 不解释、配置或替代 OpenClaw runtime 选择。
