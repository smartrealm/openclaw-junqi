# OpenClaw Talk 事件契约规格

## 问题

JunQi Talk 事件解码没有完整执行当前 OpenClaw `TalkEventSchema` 的关键关联约束，可能让半截或无效事件触发桌面播放和会话状态投影。

## 约束

- 仅消费 OpenClaw canonical `talk.event` 中满足当前官方 schema 的事件。
- `seq` 必须为大于等于 1 的整数，`timestamp` 必须为非空字符串。
- turn-scoped 事件必须有非空 `turnId`；capture 生命周期事件必须有非空 `captureId`。
- 无效 Talk envelope 由专用桥接消费，不能落入聊天事件处理，也不能驱动本地 Talk 状态。
- 不新增 RPC、事件类型、补偿状态或本地音频能力。

## 验收条件

- [x] 正确的 realtime output 和 capture 事件可以解码。
- [x] 序号零、缺失时间戳、缺失 turnId 或缺失 captureId 的事件被拒绝。
- [x] 无效 Talk 事件不会路由为聊天事件。
- [x] 相关 TypeScript 与 Talk 定向回归测试通过。
- [x] 全量质量验证与清理扫描通过。
