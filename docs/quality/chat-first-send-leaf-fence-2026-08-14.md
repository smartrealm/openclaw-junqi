# 新会话首条消息失败审计

## 根因

JunQi 在 `sessions.create` 返回空 transcript 后，把 `expectedLeafEntryId: null` 传给 `chat.send`。OpenClaw npm stable 2026.7.1-2 的正式 `ChatSendParamsSchema` 不定义该字段，因此 Gateway 在 handler 前返回：

```text
invalid chat.send params: at root: unexpected property 'expectedLeafEntryId'
```

失败后的历史刷新会清除本地空 leaf 事实，手工重发不再携带该字段，所以第二次发送正常。这解释了“每个新会话第一条失败，重发成功”的稳定复现。

## 官方主线差异

OpenClaw 官方主线提交 `8ace19a071403dfdc6adfb8901af09d2177fcc96` 已在 `chat.send` admission 与测试中正式使用 `expectedLeafEntryId`，包括 `null` 空 leaf 语义。因此 JunQi 不能永久删除该围栏，也不能按版本号判断。

## 修复

- 每个已核验连接独立记录 leaf 围栏支持状态。
- 状态未知时按最新版正式参数发送。
- 只有收到精确 `INVALID_REQUEST` 且错误明确为 `expectedLeafEntryId` 未知属性时，才能认定请求在 schema 校验阶段被拒绝，并沿用同一幂等键省略该字段发送。
- 同一连接后续发送直接使用已核验 schema；换连接后重新协商。
- 权限、模型、网络、超时和其他参数错误均不得触发降参或重放。

## 验证边界

自动化覆盖 stable 拒绝、一次协商、连接内复用及其他错误不重放。仍需在本机 stable Gateway 新建会话并发送首条消息，确认真实 UI 与 transcript 结果。
