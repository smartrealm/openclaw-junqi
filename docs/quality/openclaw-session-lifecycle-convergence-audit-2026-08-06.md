# OpenClaw 会话生命周期收敛审计

日期：2026-08-06

## 权威依据

- 当前 OpenClaw 官方源码的 `sessions.list` 支持分页、`includeDerivedTitles`、`includeLastMessage` 和 `agentId`。
- 官方会话行提供 `sessionId`、`label`、`displayName`、`derivedTitle`、`lastMessagePreview`、`pinned`、`unread` 与 `archived`。
- `agents.list` 返回 `defaultId`，默认智能体不保证名为 `main`。
- `sessions.patch` 支持 `expectedSessionId`，用于拒绝 reset 或 replacement 后到达的旧写入。
- `sessions.fork` 只返回新 `sessionKey` 和编辑器内容；新会话行仍需从 Gateway 权威投影取得。

## 审计发现

### BUG-SC-01 会话列表更新比较器丢失身份与组织字段

轮询比较器只比较少数字段，`sessionId` 或组织状态单独变化时不会更新状态仓，Reset 后可能保留旧身份。

### BUG-SC-02 活动会话刷新重复写入已读状态

`setSessions` 每次都发送 `unread: false`。Gateway 为成功 patch 广播 `sessions.changed`，从而触发再次刷新与写入。

### BUG-SC-03 官方标题和消息预览未进入客户端投影

客户端未请求 `derivedTitle` 与 `lastMessagePreview`，并忽略 `displayName`。冷启动后无标签会话无法恢复官方标题。

### BUG-SC-04 默认智能体被硬编码为 main

客户端丢弃 `agents.list.defaultId`，新会话在无法从当前会话解析 Agent 时固定回退到 `main`。

### BUG-SC-05 创建与分叉投影入口分裂

普通创建、顶部分叉、消息分叉和检查点分支分别拼装会话对象。固定分叉标签可能冲突，消息分叉会暂时使用 key 充当标签。

### BUG-SC-06 会话组织写入缺少身份围栏

置顶、归档、已读、分组和重命名没有携带当前 `sessionId`，旧操作可能在 Reset 后写入替换会话。

### BUG-SC-07 会话列表未完成分页

OpenClaw 默认返回一百条。客户端不读取后续页，冷启动和会话选择器会遗漏剩余会话。

### BUG-SC-08 客户端 topic 持久化覆盖官方标题职责

客户端根据本地消息生成并持久化 topic，乐观发送失败也可能留下服务端未确认的标题；旧存储迁移代码仍存在。

### BUG-SC-09 会话列表保留旧 Gateway 兼容回退

归档列表参数被旧 Gateway 拒绝时，客户端静默退回活动列表，与当前仅支持官方最新协议的边界不一致。

## 修复边界

JunQi 仅投影 OpenClaw 官方数据，不生成服务端不存在的会话、标题、默认 Agent 或组织状态。所有创建和分叉结果在展示前必须取得可验证的 Gateway 会话身份。

