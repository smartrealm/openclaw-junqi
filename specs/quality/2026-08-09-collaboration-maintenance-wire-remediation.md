# 协作维护线协议收敛规格

日期：2026-08-09

## 目标

让协作插件的维护门状态只有一个权威线协议字段，并在桌面端边界完成领域模型映射。

## 线协议

1. `maintenance.status`、`maintenance.enter`、`maintenance.exit` 和 capabilities 中的维护投影只返回 `gateActive`。
2. 插件不得同时返回 `active` 与 `gateActive`。
3. 桌面端解码器缺少 `gateActive` 时必须拒绝响应，不得回退到 `active`。
4. 桌面端内部可将通过校验的 `gateActive` 映射为 `CollaborationMaintenanceStatus.active`，该字段不是线协议别名。

## 验收

- 插件状态、进入、退出和 capabilities 只包含 `gateActive`。
- 仅携带旧 `active` 字段的 capabilities 和维护状态响应被拒绝。
- 维护获取、恢复和释放流程测试通过。
- 协作插件全量测试通过。
