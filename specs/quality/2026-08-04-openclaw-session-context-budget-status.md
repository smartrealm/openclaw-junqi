# OpenClaw 会话上下文预算状态投影

## 依据

- 官方 [SessionContextBudgetStatus](https://github.com/openclaw/openclaw/blob/main/src/config/sessions/types.ts) 定义预提示估算的版本、来源、路线、压缩决定和预算字段。
- 官方 [Gateway 会话行投影](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils-row.ts) 直接输出 `contextBudgetStatus`。

## 目标行为

1. 只接受完整、`schemaVersion: 1`、`source: "pre-prompt-estimate"` 且路线枚举合法的状态。
2. 只读显示 Gateway 已决定的压缩或工具结果裁剪路线；`fits` 与不自洽状态不显示提示。
3. 完整会话快照清除失效状态；JunQi 不自动压缩、裁剪、估算或修改上下文。

## 未验证边界

真实 Gateway 的预提示估算时序和目标桌面平台视觉、读屏验收仍待执行。
