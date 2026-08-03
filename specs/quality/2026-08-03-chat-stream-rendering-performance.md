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

## Acceptance

- [ ] 常规尾部流更新只替换最后一个 ResponseGroup。
- [ ] 常规尾部流更新复用历史 ResponseGroup 和 RenderBlock 引用。
- [ ] 增量结果与完整 `recomputeDerived` 的可观察值一致。
- [ ] 非尾部更新和缓存不满足前提时回退完整投影。
- [ ] final、error、abort、工具流、双流兼容快照和 chat replace 回归测试通过。
- [ ] TypeScript、边界检查、完整前端测试和构建通过。
- [ ] 真实 Tauri 长会话性能仍明确标记为未验证，除非实际完成录制。
