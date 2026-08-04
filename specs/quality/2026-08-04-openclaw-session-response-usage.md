# OpenClaw 会话响应使用量详情对齐

## 依据

- 最新 OpenClaw 官方用量追踪文档 `https://docs.openclaw.ai/concepts/usage-tracking` 将 `/usage off|tokens|full` 定义为会话级响应页脚设置，并说明该选择会保存在会话中。
- 官方文档定义三种不同会话状态：字段缺失时继承 `messages.responseUsage` 后再回落到 `off`；显式 `"off"` 始终关闭；显式 `"tokens"` 或 `"full"` 覆盖配置默认值。`"on"` 仅为 `"tokens"` 的兼容别名。
- 最新官方配置文档 `https://docs.openclaw.ai/gateway/config-agents` 将 `messages.responseUsage` 定义为默认每回复页脚模式，而不是客户端应自行生成的消息内容。
- 当前运行环境安装包的 Gateway schema 允许 `responseUsage` 为 `"off" | "tokens" | "full" | "on" | null`，并在 `sessions.patch` 中将 `null` 解释为清除会话覆盖。该安装包仅作为当前可复现协议证据，不替代最新官方契约。

## 当前行为

JunQi 已展示 Gateway 返回的部分会话用量统计，但不投影、呈现或管理会话的 `responseUsage` 覆盖。因此用户无法在桌面客户端确认响应使用量页脚是继承、显式关闭还是指定为令牌或完整详情。

## 目标行为

- `sessions.list` 原样保留 Gateway 返回的非空 `responseUsage` 字符串，并写入对应的会话状态。
- 运行时控制提供继承、关闭、令牌、完整四个官方规范选择，分别写入 `null`、`"off"`、`"tokens"`、`"full"`。
- 读取到兼容别名 `"on"` 时，控制面将其显示为令牌，但不因读取或打开面板发起写入；用户主动保存其他选择时才发送规范值。
- 无法由官方当前值域解释的 Gateway 字符串保留并显示为不可写状态，用户必须显式选择支持状态后才能覆盖。
- 保存复用既有每会话串行 `operator.admin` 的 `sessions.patch` 通道，只在 Gateway 确认回执后回写目标会话。

## 验收

1. `null`、`off`、`tokens`、`full` 与控制面选项双向精确映射；兼容别名 `on` 显示为令牌但不自动写回。
2. 未知 Gateway 字符串不被伪装为继承或受支持状态，并需显式选择才能覆盖。
3. 持久化仅经 `operator.admin` 和会话 mutation 串行通道，且只更新目标会话。
4. 三种支持语言具备完整文案；紧凑触发器不增加新的固定展示文本，弹层在受限高度仍可滚动、保存或取消。
5. JunQi 不生成响应使用量页脚、不估算成本、不修改 `messages.responseUsage` 默认配置，也不把本地统计伪装为 OpenClaw 的响应页脚。

## 未验证边界

- 未在真实 Gateway、不同渠道与不同 `messages.responseUsage` 配置下验证页脚最终投递效果。
- 未在 macOS、Windows、CentOS 或 Ubuntu 真机验证窄窗口、键盘焦点、主题和别名的视觉呈现。
