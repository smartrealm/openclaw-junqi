# OpenClaw 已确认空会话首发计划

日期：2026-08-05

## 执行顺序

1. [x] 核对 OpenClaw 官方 Gateway 协议与官方源码中的 `sessions.create`、初始 turn、fork、`activeLeafEntryId` 和 `chat.send.expectedLeafEntryId` 契约。
2. [x] 审计 JunQi 创建提交、会话身份轮换、历史加载、文本发送、语音发送和 active-leaf 冲突恢复链路。
3. [x] 在 `sessionCreate` 的 Gateway 确认边界投影非 fork 无初始 turn 的空 leaf，并保持请求 `agentId`、Gateway `key`、`sessionId` 的同一会话归属。
4. [x] 在 `ChatView` 与消息发送入口按已确认空 leaf 分流；未知 leaf 和 fork 继续使用权威历史同步。
5. [x] 在发送事务确认 Gateway 受理后失效本地空 leaf，避免把历史事实用于后续发送。
6. [x] 补充创建、发送和 UI 回归测试，执行定向测试、lint、生产构建、`git diff --check` 与 Emoji 扫描。
7. [ ] 处理全套 `pnpm test` 的既有 `src/theme/tailwindThemeBridge.test.ts` 语义颜色别名断言失败；该主题范围不在本次会话修复内。

## 文件范围

- `src/utils/sessionCreate.ts` 与对应测试：创建确认与会话投影。
- `src/components/Chat/ChatView.tsx`：历史读取分流。
- `src/components/Chat/MessageInput.tsx`、`src/components/Chat/message-input/useMessageSend.ts`、`src/runtime/JarvisVoiceRuntime.tsx`：首发可用性与语音一致性。
- `src/services/chat/sendTransaction.ts` 与对应测试：空 leaf CAS 受理后的失效。
- 本规格、计划、审计记录及目录索引。

## 风险控制

- 不以空消息数组推断空 transcript；只接受创建协议已确认的 `activeLeafEntryId: null`。
- 不把 fork 视为新空会话。
- 不在客户端重建 Gateway leaf；冲突仍由 Gateway 拒绝并触发现有权威历史刷新。
- 不更改 OpenClaw 原生会话、任务队列、Stop 或运行时选择语义。
