# OpenClaw 会话 Agent 状态投影

## 权威依据

OpenClaw [会话 patch schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts) 定义短期状态说明、注意事项和有效期。官方 [状态解析器](https://github.com/openclaw/openclaw/blob/main/src/sessions/session-agent-status.ts) 负责净化和过期判定，[Gateway 会话行](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils-row.ts) 只输出仍有效的 `agentStatus`。

## 实现边界

- JunQi 只投影严格有效的 `note`，并在标签页与当前会话栏只读显示。
- 状态消失由后续完整 `sessions.list` 快照清除；客户端不创建计时器、状态迁移或持久化副本。
- 不向 Gateway 写入状态说明、注意事项或有效期，也不改变灵动岛、任务图、工具或运行控制。

## 验证结果

- 定向回归通过 67 项：严格状态说明解析、完整会话快照清除旧投影，以及聊天编辑器和既有生产加固回归均通过。
- `pnpm lint` 通过：模块边界、发布版本一致性和 TypeScript 类型检查均通过。
- `pnpm test` 通过。测试过程仍输出既有 Radix 服务端渲染 `useLayoutEffect` 警告，未造成失败，且与本次变更无关。
- `pnpm build`、`pnpm verify:openclaw-docs` 和 `git diff --check` 已通过。

## 未验证边界

真实 Gateway 的过期和更新时序，以及目标桌面平台的视觉与读屏验收仍待执行。
