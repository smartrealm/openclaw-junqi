# OpenClaw 会话操作展示计划

日期：2026-08-05

## 实施顺序

1. 复核官方 `session.operation` schema、协议和广播边界。
2. 删除主窗口与 Quick Chat 的本地 assistant 消息投影及其无引用回调。
3. 复用 `compactionStatusBySession`，将其纳入共享活动投影。
4. 将当前会话状态置于上下文栏，并让灵动岛显示 `compacting` 活动。
5. 补充协议、状态投影和共享活动面的回归测试。

## 文件范围

- `src/services/gateway/ChatHandler.ts`
- `src/services/gateway/Connection.ts`
- `src/services/gateway/sessionOperation.ts`
- `src/App.tsx`
- `src/pages/QuickChatRoot.tsx`
- `src/utils/sessionPresentation.ts`
- `src/components/Chat/SessionContextBar.tsx`
- `src/dynamic-island/`
- 会话活动面的调用方、三语资源、测试与本记录

## 不做的事情

- 不新增 OpenClaw operation 类型、RPC 或终态字段。
- 不由 JunQi 触发压缩或推断压缩成功。
- 不把运行态持久化为会话消息。
