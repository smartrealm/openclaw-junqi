# OpenClaw 会话最近中止状态投影

## 依据

- 最新官方 [Gateway 会话行类型](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils.types.ts) 定义可选 `abortedLastRun?: boolean`。
- 官方 [会话行投影](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils-row.ts) 直接将持久化会话条目的 `abortedLastRun` 写入 Gateway 行；同一行还独立投影 `lastRunError`。
- 官方 [Gateway Protocol](https://docs.openclaw.ai/gateway/protocol) 将 `sessions.list` 定义为会话索引。中止当前运行仍由既有 `sessions.abort` 处理，不能由客户端以该只读字段代替或确认。

## 当前行为

JunQi 已将本地 Stop 与原生 `sessions.abort` 的精确确认绑定，并在消息流中显示中止结果，但会话列表丢弃 Gateway 持久化的 `abortedLastRun`。用户切换会话、重启桌面应用或等待本地流状态清理后，无法在会话导航中分辨 Gateway 最近一次运行是否被中止。

## 目标行为

1. 仅当 Gateway 行显式给出 `abortedLastRun: true` 时，作为只读会话元数据投影；缺失、`false` 或畸形值不显示已中止状态。
2. 所有会话标签和当前会话栏使用三语可访问提示呈现最近一次运行已中止；窄窗口仅保留图标。
3. 完整 `sessions.list` 快照不再给出真值时，旧投影必须清除。
4. 该状态不等于当前运行、失败、工具中止或本地 `AbortSignal` 结果；不得触发重试、恢复、队列清理、Task 状态迁移或 Gateway 写入。

## 验收

1. 严格投影仅保留显式 `true`。
2. 完整会话快照清除已消失的最近中止标记。
3. 标签与当前会话栏都有三语、可访问的只读提示，且不替代最近错误提示。
4. 不新增 `sessions.patch`、`sessions.abort`、本地计时器或持久化写入。

## 未验证边界

- 尚未在真实 Gateway 上验证中止后持久化字段的刷新时序。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机验证窄窗口和读屏体验。
