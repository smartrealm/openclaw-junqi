# OpenClaw Stop 检查点与队列对齐实施计划

日期：2026-08-03

## 执行顺序

1. [x] STCQ-01：在 Gateway Stop transaction 中保留 checkpoint 写入错误，只有成功完成后才调用
   `sessions.abort`。文件：`src/services/gateway/index.ts`。
2. [x] STCQ-02：移除普通 Composer、Jarvis 语音和 Quick Chat Stop 中的本地 `clearQueue`。
   文件：`src/components/Chat/message-input/useComposerInterruption.ts`、
   `src/components/Chat/message-input/useComposerVoice.ts`、`src/pages/QuickChatPage.tsx`。
3. [x] 为 Stop transaction 和原生 abort 参数增加行为回归测试；保留现有本地队列、显式清空和
   session teardown 的测试。
4. [x] 运行定向测试、TypeScript、前端、Rust、构建、OpenClaw 文档与协作插件验证；记录未做的
   Gateway 与跨平台真机验收。

## 非目标

- 不新增 OpenClaw RPC、queue 参数、自动 resume 或工具重试。
- 不改变 Session reset/delete、显式清空队列或 Quick Chat 窗口关闭的清理规则。
- 不把 checkpoint 写入失败伪装成已保存，也不以 admin 或其他 runtime fallback 规避错误。
