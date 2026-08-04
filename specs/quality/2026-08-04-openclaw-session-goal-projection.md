# OpenClaw 会话目标只读投影

## 依据

- 官方 [SessionGoal](https://github.com/openclaw/openclaw/blob/main/src/config/sessions/types.ts) 定义持久化目标的版本、身份、目标文本、状态、用量与续接字段。
- 官方 [Gateway 会话行投影](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils-row.ts) 先解析目标展示状态，再将 `goal` 返回给会话列表。
- 官方 [稳定会话行 schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions-row.ts) 允许额外属性，但尚未将 `goal` 枚举为稳定字段。

## 目标行为

1. JunQi 只接受 `schemaVersion: 1`、完整必填字段和类型正确可选字段的 Gateway `goal`。
2. 标签页和当前会话栏只读展示该会话的目标状态；当前会话栏可显示目标文本。
3. 完整会话快照缺失或拒绝该字段时清除旧投影。
4. 本地 Task checkpoint、协作 Run、Stop、队列和工具恢复不得创建、修改、恢复或替代 OpenClaw `goal`。

## 未验证边界

真实 Gateway 对目标状态的更新时序，以及 macOS、Windows、CentOS、Ubuntu 的视觉和读屏验收仍待执行。
