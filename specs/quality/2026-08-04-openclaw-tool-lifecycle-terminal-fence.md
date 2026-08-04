# OpenClaw 工具生命周期终态围栏规格

## 问题

JunQi 的工具卡在 result 后仍允许 update 覆盖状态，可能把终态卡显示回 running，与同一工具的持久 Task checkpoint 不一致。

## 约束

1. OpenClaw 继续拥有工具执行、结果和事件顺序的权威；JunQi 不新增协议字段或合成 tool result。
2. UI 仅对已标记 `responseState: final` 的同一卡片拒绝 start/update 回退。
3. result 不受此限制，保留既有权威结果投影和 `verification_required` 收敛能力。
4. 不改变 Task graph、`sessions.abort`、队列或远端 transcript。

## 验收条件

1. result 后的 update 不改变工具卡的终态状态、输出或 `responseState`。
2. 正常 start、update、result 生命周期保持原有展示。
3. 回归测试、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs` 与 `git diff --check` 通过。
