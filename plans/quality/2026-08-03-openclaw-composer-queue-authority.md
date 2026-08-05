# OpenClaw Composer 队列权威对齐计划

日期：2026-08-03

## 执行顺序

- [x] 核对当前 OpenClaw queue 文档、Gateway `chat.send` handler、queued-turn cancel
  identity 与 JunQi `ChatSendCoordinator` 契约。
- [x] 全量审查 Composer、Quick Chat、Jarvis、local queue、Stop 和 session mutation
  调用链，确认普通 Composer 的 `queueIfBusy: true` 是唯一错误强制本地队列入口。
- [x] 复现并定位灵动岛预览绕过 `DynamicIslandRuntime` 可见性所有权的断链。
- [x] 让普通 Composer 省略强制本地队列选择，保留原有 Gateway `clientMessageId`。
- [x] 将 Settings 预览改为 runtime-owned intent 和有界预览状态，补关闭与自动收起语义。
- [x] 补行为回归、执行完整验证、扫描无引用代码和 Emoji，更新验证记录并使用中文提交。

## 文件范围

- `src/components/Chat/message-input/useMessageSend.ts`
- `src/components/Chat/message-input/useMessageSend.test.ts`
- `src/pages/SettingsPage.tsx`
- `src/dynamic-island/DynamicIslandRuntime.tsx`
- `src/dynamic-island/model.ts`
- `src/dynamic-island/model.test.ts`
- `src/dynamic-island/integration.test.ts`
- 本规格、计划、审计记录及三层索引

## 非目标

- 不创建 JunQi 私有的 Gateway queue mode、远端 queue position、runId 或取消协议。
- 不改变 OpenClaw 的 queue 配置、`/queue` 命令、Gateway followup/collect 数据或
  `sessions.abort` 的现有语义。
- 不把灵动岛预览状态持久化为用户设置或 Gateway 状态。
