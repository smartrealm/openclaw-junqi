# OpenClaw 原生会话转向核验对齐规格

日期：2026-08-03

## 目标

在 Jarvis 使用官方 `sessions.steer` 打断并发送时，保证 RPC 异常不会把本地 Task
checkpoint 误写成已中断或未发生中断；最终状态由 OpenClaw 官方 history 的活跃 Run
证据决定。

## 约束

1. `sessions.steer` 请求、返回字段和 admission 行为以 OpenClaw 官方 schema、
   protocol 与 handler 为准。
2. 成功响应中的 `interruptedActiveRun: true` 才可立即结算旧 Run 为 aborted。
3. RPC 异常、超时或连接变化不能推断旧 Run 是否被中断。
4. 失败后的核验必须复用已有的身份围栏、单飞 `sessions.describe` 与 `chat.history`
   流程，不能引入第二套会话或 Agent 运行时。
5. 只有 history 的 `activeRunIds` 精确包含旧 Run ID 时，才允许将其从
   `cancel_requested` 恢复为 `running`。
6. 没有权威工具结果时，不生成合成 Tool Result，不重试写工具，不声明回滚或成功。

## 验收条件

- 语音 steer 的异常会请求同一 OpenClaw session 的官方核验。
- 一次 history 中的其他 Run、缺失 Run、未知响应或连接轮换都不能恢复旧 Run。
- 精确活动 Run 证据恢复旧 Run 后，不创建新会话、不发送第二条消息、不改变工具结果。
- 普通 `chat.send` 的失败路径不触发 steer 专用核验。
- 文档与测试明确记录真实 Gateway、多平台与副作用工具未验证边界。
