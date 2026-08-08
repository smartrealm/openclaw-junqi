# Chat 流式渲染性能实施计划

日期：2026-08-03

## 实施顺序

### Phase A 协议与现状核对

1. 核对 OpenClaw `2026.7.1` 的 chat、agent、session.tool、history 和终态处理。
2. 核对 JunQi `ChatHandler` 双流合并、累计快照、replace、工具边界和强制排空。
3. 记录只能借鉴的状态原则及不能改变的权威边界。

### Phase B Store 尾部增量投影

1. 在 `src/stores/chatStore.ts` 提取单消息 SemanticBlock 构建函数。
2. 增加受前提保护的尾部增量派生函数。
3. `updateStreamingMessage` 优先使用增量结果；失败时调用现有完整重算。
4. 不改变 final 和其他结构化消息写入路径。

### Phase C 回归测试

1. 验证历史 Group 和 Block 引用保持不变。
2. 验证最后一个 Group 和流式消息内容更新。
3. 验证增量结果与完整投影值一致。
4. 验证非尾部更新走安全回退并保持正确结果。

### Phase D 文档和验证

1. 更新 `docs/README.md`、`specs/README.md` 和 `plans/README.md`。
2. 运行定向 Store 和 ChatHandler 测试。
3. 运行完整测试、lint、build 和 `git diff --check`。
4. 扫描修改文件中的禁用 Unicode 符号。
5. 将真实 Tauri 长会话性能录制列为未验证边界。

### Phase E Gateway 响应阶段投影

1. 核对当前官方 `chat.send_timing` 事件、Control UI 客户端身份和 JunQi 握手身份。
2. 增加严格 decoder 与精确活动 Run 围栏，不让该只读事件创建或结算 Run。
3. 仅在输入中组件显示 Gateway 已报告的阶段和耗时；终态及会话身份清理临时状态。
4. 为 decoder、错 Run 忽略、清理和正常投影补回归，并运行完整验证。

### Phase F 动态岛跨窗口发布节流

1. 审查聊天流、动态岛快照和 Tauri `dynamic-island:update` 的调用频率及生命周期。
2. 增加有界尾部调度器，发布最新快照，并在隐藏、销毁和过期回调路径取消或阻止发布。
3. 增加合并、取消、销毁和最新快照行为回归，不改变 OpenClaw 权威状态。
4. 记录 IPC 发布节流的验证结果，并将真实 Tauri 帧时间录制保留为未验证边界。

## 文件范围

- `src/stores/chatStore.ts`
- `src/stores/chatStore.test.ts`
- `docs/quality/chat-stream-rendering-performance-audit-2026-08-03.md`
- `specs/quality/2026-08-03-chat-stream-rendering-performance.md`
- `plans/quality/2026-08-03-chat-stream-rendering-performance.md`
- 三个索引 README
