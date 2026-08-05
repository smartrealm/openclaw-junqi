# OpenClaw Stop 会话身份围栏实施计划

日期：2026-08-03

## 执行顺序

1. [x] 在 `gateway.abortChat` 增加仅供本地 checkpoint 使用的可选 sessionId，并确认
   `OpenClawSessionAbortClient` 请求参数没有变化。
2. [x] 在普通 Composer、Jarvis 语音、Quick Chat、Quick Chat 销毁与原生会话生命周期的
   Stop 调用处透传已知 sessionId。
3. [x] 删除 `TaskExecutionCoordinator.beginRun` 与其专属依赖；保留发送与 steer 状态机。
4. [x] 增加行为回归测试，并运行定向测试、lint、test、build、OpenClaw 文档、协作插件及
   Rust 验证；记录未执行的跨平台真机验收。

## 文件范围

- `src/services/gateway/index.ts`
- `src/components/Chat/MessageInput.tsx`
- `src/components/Chat/message-input/useComposerInterruption.ts`
- `src/components/Chat/message-input/useComposerVoice.ts`
- `src/pages/QuickChatPage.tsx`
- `src/pages/QuickChatRoot.tsx`
- `src/services/collaboration/sessionLifecycle.ts`
- `src/task-execution/TaskExecutionCoordinator.ts`
- 对应的行为测试、`docs/`、`specs/`、`plans/` 索引

## 非目标

- 不在客户端伪造 OpenClaw sessionId abort 参数。
- 不增加浏览器运行时依赖、平台特化路径或语音唤醒 fallback。
- 不以删除尚未证明无引用的迁移、插件或 Tauri 注册入口为代价扩大范围。
