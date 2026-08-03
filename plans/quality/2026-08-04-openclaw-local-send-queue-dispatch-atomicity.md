# OpenClaw 本地发送队列交付原子性计划

日期：2026-08-04

## 执行顺序

- [x] 审查 Composer、Quick Chat、Jarvis、`ChatSendCoordinator`、`chatStore`、Stop、会话
  mutation 与重连 drain 入口。
- [x] 核对当前安装版 OpenClaw `chat.send`、Gateway queue、queued-turn registry 与
  idempotency/abort 所有权。
- [x] 在 `chatStore.drainQueue` 开始处原子认领并移除首项，避免本地清空与异步发送竞态。
- [x] 仅在 Session 仍有效时恢复失败项到队首，补充行为回归覆盖清空、失败与会话删除。
- [x] 运行定向与全量验证、边界检查、Emoji 扫描和 `git diff --check`，记录结果并使用中文
  提交。

## 文件范围

- `src/stores/chatStore.ts`
- `src/stores/chatStore.test.ts`
- 本审计、规格、计划及三层索引

## 非目标

- 不改写 OpenClaw Gateway 的 queue mode、followup/collect 队列、远端取消身份或协议字段。
- 不增加依赖、持久化格式或平台专属实现。
