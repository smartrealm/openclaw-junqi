# OpenClaw 本地发送队列交付原子性规格

日期：2026-08-04

## 目标

让 JunQi 本地待发队列的清空、编辑、删除与交付边界一致：消息一旦被本地 queue pump
认领，即不再属于可清空的 renderer queue；消息尚未交给 Gateway 时，用户清空队列不会
遗留可继续发送的引用。

## 约束

1. 只调整 JunQi 明确拥有的 `messageQueue`。不得创建或猜测 OpenClaw 远端 queue position、
   queue mode、queued turn 或取消结果。
2. 首项必须在任何异步 checkpoint、Gateway 请求或等待之前从本地数组中同步移除。
3. 清空队列仅取消仍留在本地数组中的待发项；已经脱离本地数组的提交中项继续使用既有
   `chat.send` 交付和 OpenClaw acknowledgement 语义。
4. 交付失败时，只要 Session 仍有效，原队列项必须回到队首并保留失败信息，避免后续项越过
   失败项；Session 已删除时不得复活本地队列项。
5. 保留既有附件、display attachment、source、idempotency key、Task checkpoint、重试和
   `typingBySession` 语义。

## 验收条件

- [x] drain 开始后立即从 `messageQueue` 移除已认领首项。
- [x] 在 Gateway 请求尚未完成时调用 `clearQueue`，只取消后续项；首项只发送一次，且不被
  回写为“已取消”。
- [x] Gateway 请求失败后，首项以失败状态恢复在队首，后续项顺序不变。
- [x] Session 在请求期间已删除时，失败回调不恢复本地队列项。
- [x] 现有 OpenClaw normal send、explicit local queue、session mutation gate、附件和
  delivery-uncertain 回归继续通过。

## 非目标

- 不新增 OpenClaw RPC、配置、状态字段或用于展示远端队列的本地模型。
- 不改变 Stop、`sessions.abort` 或 Gateway queued-turn cancel 的既有行为。
