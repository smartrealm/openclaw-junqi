# OpenClaw 原生技能提案事件对齐规格

日期：2026-08-03

## 目标

在 JunQi 的 agent-scoped Skill Workshop proposal 中忠实查看官方生命周期事件，保持只读、分页、
scope 隔离和敏感字段最小化。

## 契约

1. 仅调用官方 `skills.proposals.events.list`；proposal id 非空，agent id 仅来自现有受控 scope。
2. methods 发现列表不决定入口或 RPC；按官方读取并仅由 Gateway 的结构化响应判定不支持、未授权或失败。
3. 事件页必须具有 events 数组和可选合法 nextSequence；每个 event 必须具有合法 sequence、请求的
   proposal id、版本、SHA-256 revision hash、原生类型、时间和 actor type。
4. 返回 event sequence 必须严格递增；afterSequence 必须为非负整数，limit 必须在官方 1 至 200 范围。
5. 仅投影 sequence、type、occurredAt、actorType；不得投影 eventId、hash、actorId、correlationId、
   payload 或 evaluation。
6. scope、连接、capability 变化和关闭事件对话框必须使旧异步回包失效；后页只可附加到同一 proposal
   和同一 scope 的当前结果。

## 非目标

- 不实现未被 OpenClaw 原生定义的事件、任务图、恢复流程或自动优化循环。
- 不调用 evaluate 或其他管理员/写 proposal 方法。
- 不读取本地 proposal/workspace 文件作为 Gateway 回包的替代。

## 验收

1. 正常 event page 产生最小只读投影，跨 proposal、乱序或畸形项被拒绝。
2. scope、cursor 和 limit 与官方参数契约一致；methods 发现遗漏时仍有官方调用。
3. 页面可查看首页并在存在 nextSequence 时请求后页，不在 scope 切换后显示旧页。
4. 相关自动化检查与文档验证通过，真机未验证边界明确记录。
