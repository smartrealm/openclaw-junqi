# 新建会话原生语义对齐计划

日期：2026-08-07

## 执行顺序

1. [x] 对照 OpenClaw 官方 `sessions.create`、会话行投影、`chat.history` 与 `chat.send` 生命周期锁完成全链审计。
2. [x] BUG-01：保留已确认空会话的首发无历史门禁；当 Gateway 拒绝首发时，触发一次官方历史恢复，不解析错误文本、不自动重发。
3. [x] BUG-02：以 Gateway 返回 key 的 agent 段核验创建身份；请求 Agent 与返回身份不一致时拒绝提交。
4. [x] BUG-03：删除 `createNativeSession` 参数级并发合并；每次新建意图都调用一次原生 `sessions.create`，由具体 UI 控件负责禁用重复点击。
5. [x] 更新创建、首发恢复与会话投影测试，运行定向测试、全套测试、lint、构建和差异检查。
6. [x] BUG-04：按 OpenClaw `normalizeAgentId` 规范化创建请求身份后，再与 Gateway key 的 Agent 段核验。

## 文件范围

- `src/utils/sessionCreate.ts` 与 `src/utils/sessionCreate.test.ts`
- `src/services/gateway/OpenClawSessionLifecycleClient.ts` 与对应测试
- `src/components/Chat/message-input/useMessageSend.ts` 与对应测试
- `docs/quality/openclaw-confirmed-empty-session-audit-2026-08-05.md`
- 本计划与对应规格

## 风险控制

- 普通非 fork 空会话不请求 `chat.history`，首条发送继续携带 `expectedLeafEntryId: null`。
- 恢复只调用官方 `chat.history`，不补写 transcript、不合成 Tool Result、不重放发送。
- 不根据错误文案推断 Gateway 状态；首发失败后的读取仅用于重新取得官方会话事实。
- 不改变 OpenClaw 主会话、fork、reset、Agent 路由或 Gateway 的创建语义。
