# Task 执行终态合并围栏计划

日期：2026-08-04

## 执行顺序

1. 复核 Stop、Tool、history 和 checkpoint merge 的本地状态机边界。
2. 为 run/node 的终态对活动态覆盖添加失败回归。
3. 在 merge 选择逻辑中加入终态围栏，不改变终态内部的既有优先级。
4. 运行定向和完整验证，更新索引并提交中文 commit。

## 范围

- `src/task-execution/stateMachine.ts`
- `src/task-execution/stateMachine.test.ts`
- 本记录、规格、计划和索引

## 非目标

- 不增加本地自动恢复、工具结果合成、第二个 agent runtime 或 OpenClaw 未声明的 session 字段。
