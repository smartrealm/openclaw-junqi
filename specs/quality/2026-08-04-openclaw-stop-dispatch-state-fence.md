# OpenClaw Stop 发送中状态围栏规格

日期：2026-08-04

## 目标

使语音唤醒、录音、听写和 Escape 在会话正发送或正流式输出时都进入同一条既有的原生
Stop 链路，避免本地音频已停但 OpenClaw Run 未中止。

## 约束

1. 只把 `typingBySession` 或 `sendingBySession` 为真的当前会话视为本地可中断请求。
2. 不新增或修改 OpenClaw `sessions.abort` 参数、`clearQueued` 语义、队列模式、Run 状态或
   Gateway 事件。
3. 所有远端中止仍通过既有 `gateway.abortChat`，保留 task checkpoint、精确 Run 确认和
   history reconciliation。
4. 无活动请求时，Stop 仍可停止本地语音输出，但不得发出无目标的 `sessions.abort`。
5. 共享判定必须是无副作用状态选择器，不能引入组件到 service 的新依赖。

## 验收条件

- 语音 Stop 在仅 `sendingBySession` 为真时调用既有 `gateway.abortChat`。
- Escape 在仅 `sendingBySession` 为真时阻止默认行为并调用同一 Stop 回调。
- 两个状态都为假时，语音 Stop 和 Escape 不发起远端中止。
- 定向回归、TypeScript、前端完整测试、构建、OpenClaw 文档校验、Rust library 验证和
  `git diff --check` 通过。

## 非目标

- 不用本地状态推断 Gateway 已成功中止。
- 不改变本地语音播放的中断所有权或 Task 恢复状态机。
