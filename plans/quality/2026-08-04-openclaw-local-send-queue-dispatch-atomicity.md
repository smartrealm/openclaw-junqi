# OpenClaw 本地发送队列交付原子性计划

日期：2026-08-04

## 执行顺序

- [x] 审查 Composer、Quick Chat、Jarvis、`ChatSendCoordinator`、`chatStore`、Stop、会话
  mutation 与重连 drain 入口。
- [x] 核对当前安装版 OpenClaw `chat.send`、Gateway queue、queued-turn registry 与
  idempotency/abort 所有权。
- [x] 在 `chatStore.drainQueue` 开始处原子认领并移除首项，避免本地清空与异步发送竞态。
- [x] 仅在 Session 仍有效时恢复失败项到队首，补充行为回归覆盖清空、失败与会话删除。
- [x] 核对官方 Gateway protocol 的 `chat.send` 会话执行与幂等要求，移除快捷指令和 Gateway
  发送外观的主会话回落；在协调器、外观和 UI 入口建立空目标围栏。
- [x] 补充空会话目标的行为回归，验证失败先于本地状态、Task checkpoint 和 Gateway 请求。
- [x] 运行定向与全量验证、边界检查、Emoji 扫描和 `git diff --check`，记录结果并使用中文
  提交。

## 文件范围

- `src/stores/chatStore.ts`
- `src/stores/chatStore.test.ts`
- `src/services/chat/sendTransaction.ts`
- `src/services/chat/sendTransaction.test.ts`
- `src/services/gateway/OpenClawChatSessionTarget.ts`
- `src/services/gateway/OpenClawChatSessionTarget.test.ts`
- `src/services/gateway/index.ts`
- `src/components/Chat/ChatView.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 本审计、规格、计划及三层索引

## 非目标

- 不改写 OpenClaw Gateway 的 queue mode、followup/collect 队列、远端取消身份或协议字段。
- 不增加依赖、持久化格式或平台专属实现。
