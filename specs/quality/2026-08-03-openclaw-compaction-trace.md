# OpenClaw 压缩事件追溯规格

日期：2026-08-03

## 目标

保留 OpenClaw transcript 已提供的 compaction 事件，使响应追溯能明确指出上下文边界发生过变化。

## 约束

1. 只消费现有 `CompactionBlock`，不增加 JunQi 自定义的 Gateway 事件或摘要字段。
2. 不把 system note、前端字符串匹配或本地计数转换成 OpenClaw compaction 事实。
3. 不展示 OpenClaw 未提供的摘要正文、压缩原因、压缩模型或 memory flush 结果。
4. compaction 仍作为独立 system group，不改变普通 Chat 的响应状态、Task/Session 关系或 Stop 语义。

## 验收

- 上游 compaction block 在 trace 中产生一个可定位的节点。
- 节点拥有上游 source message id、source sequence 和 transcript timestamp。
- 没有 compaction block 时，追溯输出与原行为一致。
- 三种已支持语言均有节点标题和说明。
