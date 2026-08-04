# OpenClaw `/btw` 临时侧问对齐

## 依据

- 当前安装的 OpenClaw 官方文档：`docs/tools/btw.md` 与 `docs/tools/slash-commands.md`。
- 当前安装的 OpenClaw Gateway 源码：`dist/btw-command-DCsFmn36.js` 与 `dist/chat-pg-BxhF6.js`。

官方定义 `/btw` 为针对当前会话背景的一次临时侧问：不写入 transcript 或 `chat.history`，不在刷新后重放，并通过 `chat.side_result` 回传。Gateway 在发送该事件后会为同一 `runId` 发送空的 `chat.final`；主 Run 保持不变。

## 当前行为

此前 JunQi 没有消费 `chat.side_result`。所有输入都走普通发送路径，可能创建本地乐观用户消息、输入中状态和 Task checkpoint；空的 `chat.final` 在空闲会话中还可能被投影为普通 Run。

## 目标行为

- 仅对当前客户端按 OpenClaw `/btw` 分类规则发起的 `runId` 消费 `chat.side_result`。
- 结果仅保存在内存中的会话侧问集合，不能进入消息 transcript、`chat.history` 投影、Task checkpoint 或本地发送队列。
- 同一临时 `runId` 的后续终态 `chat` 事件只能清理临时运行登记，不能影响主 Run。
- 临时结果显示在聊天视图底部，可由用户关闭；没有普通历史时也能显示。
- 非法、非本客户端登记或会话不匹配的 `chat.side_result` 必须忽略。

## 验收

1. `/btw` 不创建乐观消息、不设置主会话输入中状态、不调用 Task checkpoint，且不进入本地队列。
2. 正确的 `chat.side_result` 显示为临时卡片，关闭后从内存集合移除。
3. 主 Run 活跃时收到临时结果和随后空 `chat.final`，主 Run 仍保持活跃。
4. 非法 payload 与未登记的 run 不改变任何会话状态。
5. 切换 OpenClaw session identity、清空消息或删除会话时，临时结果一并清除。

## 未验证边界

- 尚未对真实 Gateway 发起 `/btw`，也未在 macOS、Windows、CentOS 或 Ubuntu 真机完成端到端验证。
- Gateway 断线期间的临时结果不具备历史恢复语义；这是 OpenClaw 文档定义的非持久结果，JunQi 不伪造回放或恢复。
