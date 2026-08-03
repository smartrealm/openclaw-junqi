# OpenClaw Stop 会话身份围栏审计

日期：2026-08-03

## 结论

JunQi 的 Task checkpoint 以 Gateway target、sessionKey 和可用的 sessionId 共同绑定。
此前普通 Chat、Jarvis 语音、Quick Chat、Quick Chat 窗口销毁和原生会话 reset/delete
前的 Stop 都只把 sessionKey 交给 `gateway.abortChat`。当同一 key 已轮换到新的
sessionId 时，Coordinator 可以把 Stop 意图写入同 key 的旧 checkpoint，或在存在多个
候选 checkpoint 时无法写入任何当前 checkpoint 后仍继续发送远端 Abort。

修正应把调用方已知的 sessionId 仅传给 JunQi 本地的 checkpoint 绑定。远端
`sessions.abort` 参数仍严格保持 OpenClaw 所定义的 key 与可选 runId；JunQi 不向该 RPC
捏造 sessionId 字段，也不改变 Gateway 对 Run、队列或 transcript 的权威所有权。

本轮还证明 `TaskExecutionCoordinator.beginRun` 没有静态调用方、动态注册入口、测试消费者
或文档契约。正常发送与 steer 已分别经 `prepareSend` 和 `prepareSteer` 进入相同状态机，
因此该无引用旧入口应删除，避免未来绕过发送事务的持久化前置条件。

## 权威依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
  将 `sessions.abort` 定义为按 session 停止活动工作，参数为 key 加可选 runId，或单独 runId。
- [OpenClaw Gateway protocol schema](https://github.com/openclaw/openclaw/tree/main/packages/gateway-protocol)
  是 Gateway RPC 参数的权威定义；JunQi 不可在客户端添加未定义字段。
- 当前安装的 OpenClaw `2026.7.1-2` 已编译 handler
  `dist/sessions-UcKjjh_n.js`：`sessions.abort` 读取 `key`、`runId` 和可选 `agentId`，再将
  其转换为原生 `chat.abort`；未读取 sessionId。
- 当前 JunQi `src/task-execution/TaskExecutionCoordinator.ts`：任务 id 由
  targetFingerprint、sessionKey 和可选 sessionId 构成，且 `resolveTaskExecutionBinding` 已能在
  调用方提供 sessionId 时做精确匹配。

## 当前行为与风险

| 边界 | 当前行为 | 风险 |
| --- | --- | --- |
| 本地 Stop checkpoint | `abortChat` 只向 Coordinator 传 sessionKey | key 轮换后可命中旧 checkpoint，或多候选时无 checkpoint |
| Gateway Stop RPC | `sessions.abort` 使用 key 与可选当前 runId | 这是原生契约，不能加入本地 sessionId |
| UI Stop 调用方 | 已从 store 或页面 props 取得 sessionId，但未透传 | 丢失本可用于本地身份围栏的证据 |
| Task 状态机旧入口 | `beginRun` 无消费者 | 保留会鼓励绕过受控发送事务 |

## 目标行为

1. `gateway.abortChat` 接受仅用于本地 checkpoint 的可选 sessionId，并在调用
   `requestStop` 时原样传递。
2. 每个具备已知 sessionId 的 Stop 入口都透传该值；身份未知时维持现有 key-only 行为，
   不猜测或请求伪造身份。
3. 调用 Gateway 的 `sessions.abort` 时只使用官方 `key`、可选 `runId` 和现有受控的
   `agentId` 语义；sessionId 永不进入 RPC payload。
4. 删除无消费者的 `TaskExecutionCoordinator.beginRun`，所有本地 Run 创建继续经
   `prepareSend` 或 `prepareSteer`。

## 验证结果与未验证边界

- 定向回归：`TaskExecutionCoordinator`、Gateway Stop facade、原生 abort 参数和 Stop
  transaction 共 10 项通过。facade 测试使用未连接 Gateway 的真实拒绝路径，确认本地
  checkpoint 收到当前 sessionId 后才进入远端 abort。
- `pnpm lint` 通过：模块边界、版本一致性和 TypeScript 检查通过。
- `pnpm test` 通过：2,643 项通过，0 项失败。测试输出含项目既有的 React 服务端渲染
  `useLayoutEffect` 警告，未影响结果。
- `pnpm build`、`pnpm verify:openclaw-docs`、`pnpm collab:test`、
  `pnpm collab:validate` 均通过；构建仅报告既有的动态与静态导入分包提示。
- `pnpm test:rust` 通过：703 项通过、3 项跳过。

本地自动化无法替代 Windows、macOS、CentOS 或 Ubuntu 的真实 Gateway 与麦克风语音验收；
本变更不修改平台宿主、音频权限或 OpenClaw Talk/VoiceWake 的运行时能力。
