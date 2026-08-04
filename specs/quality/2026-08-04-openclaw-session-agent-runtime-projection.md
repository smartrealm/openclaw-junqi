# OpenClaw 会话 Agent Runtime 投影

## 依据

- 最新 OpenClaw [Gateway Protocol](https://docs.openclaw.ai/gateway/protocol) 规定，`sessions.list` 的会话行在配置 Agent runtime backend 时返回 `agentRuntime`；`sessions.patch` 返回已解析的有效 `agentRuntime`。
- 官方源码 `src/shared/session-types.ts` 将该元数据定义为至少包含非空 `id` 的对象；`fallback` 与 `source` 是附加诊断信息，客户端不得据此推断模型兼容性或改写运行时策略。
- `sessions.patch` 是 Gateway 控制平面的持久化入口。JunQi 只消费 Gateway 已确认的结果，不能新增 runtime 选择、回退或修复逻辑。

## 当前行为

JunQi 已在会话状态卡显示模型与思考等级，但丢弃 `sessions.list[].agentRuntime` 和模型变更回执的 `resolved.agentRuntime`。当模型名称与实际执行 backend 不同或 runtime 由 provider/model 策略解析时，桌面界面无法显示 Gateway 已确认的执行事实。

## 目标行为

1. 只接受 `agentRuntime.id` 为非空字符串的 Gateway 元数据；字段缺失、非法对象或空 id 一律按未知处理，不构造默认 runtime。
2. 会话列表全量刷新以 Gateway 行为权威，保留有效 runtime id，并在行缺失时清除旧投影。
3. `sessions.patch` 已确认的模型回执若包含有效 runtime，则立即更新目标会话；回执缺失该字段时不得清除现有投影或把它猜测为某个默认值。
4. Agent 会话状态卡仅在 Gateway 已提供 runtime id 时展示该值，作为只读诊断信息；不提供 runtime 编辑、兼容性判断或自动回退。

## 验收

1. 解析器拒绝空、非对象和缺失 id 的 `agentRuntime`，保留有效未知未来 id。
2. 会话状态快照保留对应会话的有效 runtime，活动会话不能借用其他标签页的 runtime。
3. 模型 patch 的已确认有效 runtime 可以定向回写；回执缺失时既有值不被本地清空。
4. 三种支持语言的状态卡标签完整，且没有客户端运行时固定列表。

## 非目标

- 不实现 `sessions.dispatch`、云 worker placement、Agent runtime 配置编辑或模型/runtime 兼容性推断。
- 不以 OpenClaw 版本号、供应商名称、模型名称或当前开发机环境推测 runtime。
- 不替代 Gateway 对模型路由、认证、失败关闭或 fallback 的权威决策。

## 未验证边界

- 未在实际配置 Codex、Claude CLI、OpenClaw embedded 或后续插件 runtime 的 Gateway 上逐项验证显示与模型切换时序。
- 未在 macOS、Windows、CentOS 或 Ubuntu 真机验证长 runtime id 的窄窗口显示。
