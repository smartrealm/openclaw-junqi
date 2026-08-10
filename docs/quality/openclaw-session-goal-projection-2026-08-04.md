# OpenClaw 会话目标只读投影

## 边界

OpenClaw 的 `SessionGoal` 是 Gateway 持久化的会话目标。JunQi 仅在 `sessions.list` 返回完整且可验证的状态时投影它：标签页显示状态图标，当前会话栏显示目标和状态。没有目标、字段不完整或类型不正确时，不保留旧值。

`packages/junqi-collab/` 的 goal 属于协作 Run，并不等价于 OpenClaw `SessionGoal`，不向 Gateway 伪造状态或写入目标。普通聊天的发送、Stop 和工具状态只来自 OpenClaw 会话事件与回执。现有 `sessions.patch` 只继续使用官方已验证的会话组织与设置字段。

## 验证结果

- 定向回归 49 项通过，覆盖目标解析、伪造状态拒绝和完整会话快照清除。
- `pnpm lint` 通过，包含 TypeScript、模块边界与发布版本一致性检查。
- `pnpm build` 通过，包含协作插件契约、TypeScript 和 Vite 生产构建。
- `pnpm verify:openclaw-docs` 通过。
- `git diff --check` 已通过。

## 未验证边界

真实 Gateway 目标刷新时序，以及 macOS、Windows、CentOS、Ubuntu 真机视觉与读屏验收仍待执行。
