# OpenClaw 会话最近运行错误投影

## 依据

- 最新 [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol) 将 `sessions.list` 定义为当前会话索引。
- 官方 [Gateway 会话行类型](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils.types.ts) 将 `lastRunError?: string` 定义为最近一次失败或超时运行的紧凑用户可见原因。
- 官方 [会话行投影](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils-row.ts) 直接把持久化会话的 `lastRunError` 输出到 Gateway 行；该字段的生成、清除、终态与重试均由 OpenClaw 负责。

## 当前行为

JunQi 已投影会话运行状态、活跃运行和子智能体运行，但忽略 `lastRunError`。用户切换到其他标签页后，无法在会话导航或当前会话栏辨识 Gateway 已记录的最近失败或超时原因。

## 目标行为

1. 仅接受非空字符串的 `lastRunError`，将其作为只读会话元数据；缺失、空白或非字符串按未知处理。
2. 在任意会话标签显示简洁错误标记，并在当前会话上下文栏显示可访问的最近运行失败提示；完整原因只通过原生提示文本暴露，避免挤压窄窗口主操作。
3. 完整会话刷新以 Gateway 行为权威：字段消失时清除本地投影，不把旧错误保留为当前事实。
4. JunQi 不从该字段推断当前运行状态、执行重试、清空错误、创建消息或改变任务、会话、工具状态。

## 验收

1. 解析器保留非空错误文本并拒绝空白、对象、数组和其他类型。
2. 会话列表映射保留合法错误，完整刷新可以清除旧错误。
3. 标签页和当前会话栏的错误标记包含本地化可访问名称与完整错误提示，且不影响模型、输入、停止或会话控制。
4. 中文、英文和繁体中文包含相同语义的最近运行失败文案。

## 非目标

- 不实现运行重试、错误确认、自动诊断、错误聚合或本地失败状态机。
- 不把 Gateway 错误写入 transcript、持久化存储、日志、通知历史或 OpenClaw 配置。
- 不把 `lastRunError` 当作当前活跃运行、工具调用失败或模型不可用的证明。

## 未验证边界

- 尚未在真实失败、超时、成功后清除和多会话并发情况下验证 Gateway 的字段时序。
- 尚未在 macOS、Windows、CentOS、Ubuntu 的 Tauri 窄窗口中进行真实视觉与读屏验收。
