# OpenClaw 会话上下文预算状态投影

## 边界

JunQi 只投影 OpenClaw 预提示估算产生的完整 `contextBudgetStatus`。当 Gateway 明确给出压缩、工具结果裁剪或两者组合路线时，标签页和当前会话栏显示只读提示；客户端不自动执行该动作。

## 验证结果

- 定向回归通过 52 项，覆盖完整状态解析、路线一致性和完整会话快照清除。
- `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs` 均通过。
- `git diff --check` 已通过。

## 未验证边界

真实 Gateway 预算路线刷新时序，以及 macOS、Windows、CentOS、Ubuntu 真机视觉与读屏验收仍待执行。
