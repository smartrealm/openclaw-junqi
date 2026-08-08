# Chat 流式渲染性能规格

日期：2026-08-03

## Current

OpenClaw 向 JunQi 发送累计流快照。`ChatHandler` 已合并双文本流并做 50ms 微批，但 `chatStore.updateStreamingMessage` 每次刷新仍重新投影完整会话：

- 规范化全部消息；
- 重建全部 SemanticBlock；
- 重建全部 ResponseGroup；
- 重建全部 RenderBlock。

长会话的流式更新成本因此随历史长度增长。Virtuoso 只能限制 DOM 挂载量，不能避免 Store 全量派生。

## Target

### STREAM-PERF-01 尾部增量投影

当目标消息是会话最后一条、已存在于最后一个 ResponseGroup，且此前缓存与消息序列一致时：

- 仅规范化目标消息；
- 仅替换最后一个 ResponseGroup 中来自目标消息的 SemanticBlock；
- 仅重建最后一个 Group 对应的 RenderBlock；
- 复用所有历史 Group 和 Block 引用。

### STREAM-PERF-02 安全回退

以下情况必须使用完整投影，不猜测结构：

- 首次创建流式消息；
- 更新非尾部消息；
- 最后一个 Group 不包含目标消息；
- 缓存缺失、长度不一致或身份不一致；
- 新投影不能形成合法尾部分组。

### STREAM-PERF-03 OpenClaw 契约保持

优化不得改变：

- session、run 和 message identity；
- 累计快照、replace 和双流纠偏语义；
- final、error、abort 前的强制排空；
- 工具边界和 transcript 权威收敛；
- 流式纯文本与终态 Markdown 的现有切换。

### STREAM-PERF-04 Gateway 响应阶段

对官方 `chat.send_timing` 事件：

- 仅接受完整、非负有限耗时和当前官方已定义阶段；未知字段或阶段不推断。
- 仅当 `sessionKey` 和 `runId` 与当前活动 OpenClaw Run 精确一致时才投影。
- 只在当前响应的临时 UI 中呈现 Gateway 报告的阶段与耗时；不得持久化或用于 Stop、重试、队列和 Task 状态转换。
- Run 结算、会话删除、重置或 identity 轮换必须清除该投影。

### STREAM-PERF-05 动态岛跨窗口发布

动态岛快照是 JunQi 的本地 UI 派生状态，不得改变 OpenClaw 的权威状态。高频聊天流更新期间：

- `dynamic-island:update` 事件应合并为有界的尾部发布，而不是为每个 React 渲染批次发送一次；
- 发布必须读取最新快照，中间快照可以被合并但不能用旧快照覆盖新状态；
- 动态岛显示、隐藏、`ready` 初次同步和销毁必须分别保持即时同步、取消待发布回调或阻止过期回调；
- 调整只影响跨窗口 UI 投影频率，不得改变 session、run、task、transcript 或工具副作用语义。

## Acceptance

- [ ] 常规尾部流更新只替换最后一个 ResponseGroup。
- [ ] 常规尾部流更新复用历史 ResponseGroup 和 RenderBlock 引用。
- [ ] 增量结果与完整 `recomputeDerived` 的可观察值一致。
- [ ] 非尾部更新和缓存不满足前提时回退完整投影。
- [ ] final、error、abort、工具流、双流兼容快照和 chat replace 回归测试通过。
- [ ] TypeScript、边界检查、完整前端测试和构建通过。
- [ ] 真实 Tauri 长会话性能仍明确标记为未验证，除非实际完成录制。
- [ ] `chat.send_timing` 的畸形、过期或错 Run 事件不会改变当前响应视图。
- [x] 动态岛高频更新由调度器合并发布，且取消和销毁不会发送过期快照。
- [ ] 真实 Tauri 窗口的聊天流、终端高输出和窗口拖拽帧时间已录制；未录制前保持未验证。
