# OpenClaw Task 工具事件 Run 绑定规格

## 问题

JunQi 对已重置 session key 的新旧 native session identity 同时保存 Task checkpoint。官方工具事件只提供 session key 和 runId，原有 key-only 解析在两个 checkpoint 共存时不记录任何工具节点，可能使中断后的本地恢复快照遗漏未结工具。

## 约束

1. JunQi 是 OpenClaw 客户端；不得创造 RPC 字段、远端任务或工具结果。
2. 关联仅使用官方事件中的 `sessionKey` 和 `runId`，及 JunQi 已保存的、当前已验证 runtime binding。
3. runId 必须在候选 checkpoint 中唯一存在；不存在或不唯一必须不写入。
4. 普通 Stop 的 `sessions.abort` 参数、`clearQueued` 缺省语义和原生队列权威保持不变。
5. 修改前后 Task checkpoint 的持久化、冲突合并和工具恢复状态机保持既有契约。

## 验收条件

1. 同一个 key 的两个不同 session identity 都有 checkpoint 时，带新 Run ID 的工具事件准确写入新 checkpoint。
2. 旧 Run ID 仍只能写入旧 checkpoint。
3. 未知或重复 Run ID 不产生工具节点。
4. 关联后的未结工具在 Run 被中断时仍会进入 `verification_required`。
5. 回归测试、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs` 与 `git diff --check` 通过。
