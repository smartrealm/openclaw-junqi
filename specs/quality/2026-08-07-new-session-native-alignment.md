# 新建会话原生语义对齐规格

日期：2026-08-07

## 依据

- OpenClaw `SessionsCreateParamsSchema` 将 `agentId`、`parentSessionKey` 与 `fork` 定义为创建参数。
- 未传 key 的 `createGatewaySession` 为目标 Agent 生成唯一 dashboard key。
- `SessionRowSchema` 允许 `sessionId` 与 `activeLeafEntryId` 缺省；`chat.send` 在生命周期锁内复核 session identity 和 `expectedLeafEntryId`。

## BUG-01：空会话首发失败后必须只做官方恢复

**当前**：已确认空会话跳过历史预热是正确的。但若稀疏列表行遮蔽后续身份轮换，Gateway 会拒绝首发；客户端只识别 `active-leaf-changed`，其他拒绝不会主动重新读取官方会话事实。

**目标**：已确认空会话仍直接首发。该首发被 Gateway 拒绝时，客户端后台执行一次 `chat.history` 强制读取以收敛身份和 leaf，不自动重发，不依赖错误消息文本。

**验收**：

- [x] 已确认空会话不会在发送前读取历史。
- [x] 任意首发拒绝只触发一次后台官方历史恢复。
- [x] 恢复不清空输入、不自动再次发送、不写入合成消息。

## BUG-02：创建结果 Agent 身份必须来自 Gateway key

**当前**：创建提交把请求 `agentId` 写入本地会话，即使返回 key 的 Agent 段不同。

**目标**：返回 key 的 Agent 段是本地投影身份；请求与结果不一致时拒绝整个创建结果。

**验收**：

- [x] 一致的创建结果保留 Gateway key、sessionId 和 key 中的 Agent。
- [x] 不一致结果不进入会话状态。

## BUG-04：Agent 身份比较必须使用 OpenClaw 规范形式

**当前**：Gateway 会按官方 `normalizeAgentId` 规范化创建请求。客户端若把未经规范化的请求值与 key
中的 Agent 段直接比较，会把 `MAIN` 与 `main` 误判为身份不一致。

**目标**：创建响应校验使用 OpenClaw `normalizeAgentId` 的同一规范化规则；本地投影仍只采用 Gateway
key 中已确认的 Agent 段。

**验收**：

- [x] 大小写不同但规范后相同的请求可接受 Gateway 返回。
- [x] 规范后仍不一致的创建结果不进入会话状态。

## BUG-03：每次新建意图必须保留 OpenClaw 的新建语义

**当前**：相同参数的并发创建被本地 Map 合并为一次 Gateway 调用。

**目标**：删除该 Map。每次 `createNativeSession` 调用都向 Gateway 发起一次原生创建；UI 自身已有进行中禁用时，重复点击由该 UI 层阻止。

**验收**：

- [x] 两次相同创建调用产生两次 Gateway 请求和两个独立提交结果。
- [x] 不保留无消费者的并发合并状态或测试。
