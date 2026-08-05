# OpenClaw 压缩事件追溯对齐

日期：2026-08-03

## 依据

OpenClaw 官方 [Compaction 文档](https://github.com/openclaw/openclaw/blob/main/docs/concepts/compaction.md) 说明：压缩会把较早对话总结为 compact entry，摘要写入 session transcript，后续运行只改变模型可见上下文；工具调用和对应结果在切分时保持成对。JunQi 的 Gateway transcript 解析链已经把上游 compaction 记录转换成 `CompactionBlock`。

## 当前行为

- `buildSemanticBlocks` 和 `projectSemanticBlocksToRenderBlocks` 已经保留 `compaction` block。
- `buildResponseGroups` 为 compaction 建立独立 system group，避免把压缩边界并入普通 assistant response。
- `projectChatResponseTrace` 过去把 `compaction` 与 `system-note` 一起丢弃，导致追溯无法解释上下文何时改变。

## 本次目标行为

- 追溯投影保留已有 `CompactionBlock`，生成独立的 `compaction` 节点。
- 面板只显示“OpenClaw 在 transcript 报告了压缩事件”和原始时间、来源序号，不生成摘要正文，不猜测压缩原因或模型选择。
- `system-note` 仍不自动提升为追溯节点；它没有统一的 OpenClaw 事件契约，继续保持现有失败关闭边界。

## 验证

- `chatResponseTrace.test.ts` 验证上游 compaction 节点保留且顺序稳定。
- UI 契约测试验证三语言 compaction 文案和节点展示入口。
- TypeScript 类型检查通过。

## 未验证边界

- 未连接真实 Gateway 验证不同 `notifyUser`、自动压缩、手动 `/compact` 和 degraded notice 的具体 transcript 记录文本。
- JunQi 不修改 OpenClaw 压缩配置，不实现新的压缩 provider，也不把本地提示词当作压缩摘要。
