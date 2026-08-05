# OpenClaw Stop 派发前围栏计划

日期：2026-08-04

- [x] 核对 Task Run 持久化、Gateway pending send、Stop 和队列排空的状态时间线。
- [x] 证实 Stop 可在 Gateway 登记前完成而发送仍继续派发。
- [x] 增加精确 Run 的只读取消状态查询，并在所有本地发送事务派发前应用。
- [x] 将远端 Stop 判定收窄到 Gateway-owned Run，补充普通和语音转向回归。
- [x] 执行验证与扫描。
- [x] 使用中文提交。

## 文件范围

- `src/task-execution/TaskExecutionCoordinator.ts`
- `src/services/chat/sendTransaction.ts`
- `src/stores/chatStore.ts`
- `src/components/Chat/message-input/useMessageSend.ts`
- 相关测试与本记录
