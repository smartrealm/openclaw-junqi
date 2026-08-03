# OpenClaw 原生会话转向核验对齐计划

日期：2026-08-03

## 顺序

- [x] 阅读项目根文档、既有 Task checkpoint/abort/queue 记录和相关实现。
- [x] 核对 OpenClaw 当前 `sessions.steer` schema、protocol、handler 与 `chat.send`
  admission 时序。
- [x] 审计 Jarvis 语音发送、Gateway facade、Run projection、Task checkpoint 和
  history reconciliation。
- [x] 在 steer 异常后触发现有单飞 history 核验。
- [x] 让状态机仅依据精确的 history 活跃 Run 恢复取消意图，并补充回归测试。
- [x] 执行 TypeScript、完整测试、构建、官方链接、差异和 Unicode 扫描，中文提交。

## 文件范围

- `src/services/gateway/index.ts`
- `src/services/chat/sendTransaction.ts`
- `src/task-execution/stateMachine.ts`
- `src/task-execution/*.test.ts`
- 对应 `docs/`、`specs/`、`plans/` 索引

## 不做的事情

- 不在 JunQi 中实现 OpenClaw 的 interruption lifecycle、queue 或 transcript repair。
- 不把 Gateway RPC 异常解释为远端中断失败或成功。
- 不写入合成 Tool Result，不自动恢复、重试或补偿副作用工具。
