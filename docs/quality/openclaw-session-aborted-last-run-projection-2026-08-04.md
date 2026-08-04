# OpenClaw 会话最近中止状态投影

## 权威依据

官方 [GatewaySessionRow](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils.types.ts) 将 `abortedLastRun` 定义为可选会话行字段。官方 [会话行生成器](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils-row.ts) 直接投影持久化条目的 `abortedLastRun`，而不由客户端推断。

## 实现边界

- JunQi 只展示 Gateway 显式给出的真值，作为最近一次运行已中止的只读历史提示。
- 缺失、假值或畸形值不在客户端解释为中止、成功或失败；完整会话快照负责清除旧投影。
- 本次不改动 Stop、恢复、队列、语音、任务图或灵动岛，也不向 Gateway 写入任何状态。

## 验证结果

- 定向回归通过 74 项：严格真值解析、完整会话快照清除旧标记、既有 Stop 检查点与原生会话中止契约均通过。
- `pnpm lint` 通过：模块边界、发布版本一致性和 TypeScript 类型检查均通过。
- `pnpm test` 通过。测试过程仍输出既有 Radix 服务端渲染 `useLayoutEffect` 警告，未造成失败，且与本次变更无关。
- `pnpm build`、`pnpm verify:openclaw-docs` 和 `git diff --check` 已通过。

## 未验证边界

真实 Gateway 的持久化刷新时序，以及目标桌面平台的视觉与读屏验收仍待执行。
