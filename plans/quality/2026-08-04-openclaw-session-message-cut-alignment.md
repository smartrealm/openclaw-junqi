# OpenClaw 原生会话消息截断对齐计划

1. [x] 核对官方 Gateway schema、权限描述、handler、Control UI 重绕/分叉和附件恢复流程。
2. [x] 将 JunQi attachment 模型对齐为官方可选 `fileName`，修复传输层错误补写文件名的问题。
3. [x] 新增严格的 rewind/fork Gateway client，并绑定现有会话 mutation 串行器。
4. [x] 在可验证的历史用户消息操作栏加入确认后的重绕和分叉，并接入 history fence、编辑器恢复和
   会话切换边界。
5. [x] 补齐行为回归、三语文案和质量记录。
6. [ ] 在真实 Gateway 以及 macOS、Windows、CentOS、Ubuntu 验证重绕、分叉、活动 Run 拒绝和
   恢复图片。

## 文件范围

- `src/services/chat/{types,attachments}.ts`
- `src/services/gateway/OpenClawSessionMessageCutClient.ts`
- `src/services/gateway/OpenClawSessionMessageCutClient.test.ts`
- `src/services/gateway/index.ts`
- `src/components/Chat/{ChatView,MessageBubble,MessageBubbleActions}.tsx`
- `src/components/Chat/message-input/{ComposerAttachmentTray,useMessageSend}.ts(x)`
- `src/locales/{zh,en,zh-TW}.json`
