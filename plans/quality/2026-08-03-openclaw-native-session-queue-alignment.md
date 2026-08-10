# OpenClaw 原生会话队列对齐计划

## 顺序

- [x] 阅读 README、docs/README、CONTEXT、Chat 发送和本地
  队列实现。
- [x] 核对 OpenClaw 官方 queue-steering、queue、Gateway protocol 和 chat.send
  handler 的当前契约。
- [x] 将普通活动会话发送交给 Gateway，不再默认放入 JunQi 本地队列。
- [x] 保留显式本地队列和会话 mutation gate，并补齐 Task/Session 单活动 Run
  状态机边界。
- [x] 增加普通发送、显式本地队列和 Task Run 复用的回归测试。
- [x] 更新 docs、specs、plans 索引，记录真实验证和未验证平台边界。
- [x] 按更新后的官方 OpenClaw 工作树复核 `chat.send`、queued turn 取消身份与
  共享会话建议/输入状态协议，确认当前实现无需伪造共享会话能力。
- [ ] 在具备真实 Gateway 的 macOS、Windows、CentOS、Ubuntu 桌面环境中验证各
  queue mode、断连恢复和 Jarvis steering。

## 文件范围

- `src/services/chat/sendTransaction.ts`
- `src/stores/chatStore.ts`
- 对应回归测试和三层文档

## 验证命令

```bash
node --import ./test-setup.ts --import tsx --test src/services/chat/sendTransaction.test.ts
node --import ./test-setup.ts --import tsx --test src/services/chat/sendTransaction.test.ts
node --import ./test-setup.ts --import tsx --test src/components/Chat/MessageInput.composer.test.ts
pnpm exec tsc --noEmit
git diff --check
```
