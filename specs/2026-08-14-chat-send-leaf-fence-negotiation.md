# chat.send leaf 围栏协商规格

## 当前行为

新会话首发固定携带 `expectedLeafEntryId: null`。不支持该字段的 stable Runtime 在 handler 前拒绝请求，消息显示发送失败。

## 目标行为

1. 最新正式 leaf 围栏参数继续作为首选请求。
2. 只接受精确的 Gateway schema 拒绝作为不支持证据。
3. 已证明请求未进入 handler 后，沿用同一幂等键按该连接的正式较小 schema 发送。
4. 能力结论绑定连接身份；连接换代后重新核验。
5. 任何结果未知或其他业务失败都不自动重放。

## 验收条件

- stable Runtime 新会话首条消息不显示发送失败。
- 支持 leaf 围栏的 Runtime 仍收到原始 `null` 或 leaf 标识。
- 同一 stable 连接只发生一次能力拒绝。
- 其他 `INVALID_REQUEST` 与传输错误只发送一次。
