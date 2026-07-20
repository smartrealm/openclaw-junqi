# 会话来源聚合审查

## 🟡 BUG-SESS-01 · Cron 运行泄漏到用户会话列表

**位置**：`src/components/Layout/NavSidebar.tsx`

当前侧栏只排除 `subagent`，因此 `agent:<id>:cron:<job>:run:<run>` 会被当成普通聊天会话。实时消息层却明确忽略 Cron，会造成可见但无法正常交互的空会话。

**修复**：通过统一分类器把 Cron、梦境和子智能体运行从普通会话投影中分离，并聚合到“后台活动”。

## 🟡 BUG-SESS-02 · Gateway 来源字段在映射时丢失

**位置**：`src/App.tsx`、`src/stores/chatStore.ts`

`sessions.list` 已返回 `origin`、`spawnedBy`、`status`、`hasActiveRun` 等字段，但 JunQi 只保留 `kind/channel/running`。前端只能依赖零散字符串判断，无法稳定区分用户会话和系统运行。

**修复**：完整保留分类所需的官方字段，未知来源采取保守展示策略。

## 🟡 BUG-SESS-03 · 后台会话判断散落且语义不一致

**位置**：`src/components/Layout/NavSidebar.tsx`、`src/services/gateway/ChatHandler.ts`、`src/pet/usePetStateEmitter.ts`

不同模块分别使用 `includes(':cron:')` 和 `includes(':subagent:')`，无法覆盖官方 key 结构和兼容格式，后续协议变化容易产生漂移。

**修复**：建立单一会话来源分类器，侧栏聚合和消息隔离共享同一 key 解析规则。
