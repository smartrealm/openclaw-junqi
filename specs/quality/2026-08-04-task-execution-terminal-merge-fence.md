# Task 执行终态合并围栏规格

日期：2026-08-04

## 问题

Task checkpoint 的跨视图合并按更新时间优先。若一个旧活动快照晚于终态 checkpoint 写入，`running` 或 `cancel_requested` 状态可能重新覆盖已终止的 run/node。

## 目标

1. 已终止 run 不得被较晚的活动快照重开。
2. 已终止 node 不得被较晚的活动快照重开。
3. 两个终态的现有收敛规则保持可用，特别是 `verification_required` 的权威结果收敛。
4. 不修改 OpenClaw `sessions.abort`、队列、history、工具协议或远端 transcript。

## 验收

- run 和 node 的终态/活动态 merge 回归测试在修复前失败、修复后通过。
- 原有状态机、Task coordinator、Stop 与工具生命周期测试继续通过。
- 完整 TypeScript、Rust、前端、构建、OpenClaw 文档链接和 diff 验证通过。
