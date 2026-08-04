# OpenClaw Transcript Active Leaf 围栏规格

## 范围

本规格约束 JunQi 对 OpenClaw 已公开 `chat.send.expectedLeafEntryId`、
`sessions.list.activeLeafEntryId` 与 `chat.history.sessionInfo.activeLeafEntryId` 的忠实
投影。它不引入本地 transcript 分支、恢复或调度机制。

## 目标行为

1. JunQi 只接受 Gateway 返回的非空 leaf string 或明确 `null`；字段缺失、空字符串和
   非法值均表示未知，不能被转换为任意默认值。
2. 会话列表和最新 history 成功响应都可更新对应 Session 的 leaf；sessionId 变化必须清除
   旧 leaf。
3. 普通 `chat.send` 仅在 leaf 已知时发送 `expectedLeafEntryId`；明确 `null` 表示已验证的
   空 transcript，未知则省略字段。
4. `sessions.steer`、本地 visible queue 与 `/btw` 不得伪造或复用该 `chat.send` 字段。
5. Gateway 返回 `details.reason: "active-leaf-changed"` 时，保留失败消息、附件和草稿，
   强制刷新对应 history，不自动重发。

## 验收条件

- 发送适配器逐字保留有效 leaf 与 `null`，但不会传入未知值。
- 会话 identity 轮换后不再携带旧 leaf。
- 普通发送、steer 和拒绝错误分类均有回归测试。
- TypeScript、相关定向测试和 diff 检查通过。

## 非目标

- 不在 JunQi 创建、选择或恢复 transcript branch。
- 不将一次 history 响应或错误推断为已成功发送。
- 不为旧 Gateway 硬编码版本分支、模拟返回字段或伪造兼容成功。
