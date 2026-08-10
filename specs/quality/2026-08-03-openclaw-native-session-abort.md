# OpenClaw 原生会话中止对齐规格

日期：2026-08-03

## 目标

桌面 Stop 使用 OpenClaw 官方 `sessions.abort`，只停止当前 Run，保留同一
OpenClaw session 的 transcript。

## 约束

1. 请求字段、返回状态和权限以 OpenClaw 官方 schema、handler 和方法目录为准。
2. JunQi 普通连接使用 `operator.write`；不为 Stop 额外提升到 `operator.admin`。
3. 普通 Stop 不发送 `clearQueued: true`，不替用户清空 OpenClaw followup/lane 队列。
4. 只有精确匹配的 `abortedRunId` 才能结算本地 Run；`no-active-run`、缺失 ID 或
   错配必须进入 reconciliation。
5. 中断工具调用没有权威结果时，不合成 Tool Result、不自动重试、不声称回滚。
6. `AbortSignal` 只能终止桌面等待，不得被解释为远端 Run 已中止。

## 验收条件

- Stop 发送 `sessions.abort` 的官方字段，并保留当前 `sessionKey` 与可观察 Run ID。
- OpenClaw 返回 `status: "aborted"` 且 ID 精确匹配时，本地 Run 进入 aborted；否则
  保持待核验并读取官方 history/session 状态。
- Stop 后再次发送仍使用同一 session transcript，不创建伪造的恢复会话。
- 本地语音、普通 Chat、Quick Chat 和 Jarvis 共用同一个 Gateway Stop facade。
- 文档记录自动化通过项、真实 Gateway 和多平台未验证边界。
