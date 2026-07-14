# Gateway 单核心收敛计划

| 阶段 | 缺陷 | 实施 |
| --- | --- | --- |
| A | BUG-GSC02/03/05 | 修正 FSM 优先级；Manager 的所有状态提交统一进入 `dispatch` |
| A | BUG-GSC01 | 将 App 的恢复步骤收进 Manager，移除调用方直接拼接的 lifecycle 操作 |
| B | BUG-GSC04 | 合并 Rust lifecycle/mode 状态锁，只保留 `GatewayProcess::transition` 写入口 |
| C | BUG-GSC06 | 每个缺陷增加行为回归测试和禁止旁路的边界断言 |
| D | 全部 | TypeScript、前端测试、Rust 测试、边界检查、生产构建与真实 Tauri 验证 |

## 完成性复核执行顺序

| 阶段 | 缺陷 | 实施 |
| --- | --- | --- |
| A | BUG-GSC07 | 将 restarting 合入 Rust 私有 runtime 锁并统一 transition 写入 |
| A | BUG-GSC08 | 修复 restart port 写入顺序；gateway_status 观测写入纳入 operation gate |
| B | BUG-GSC09 | 初始化、恢复意图全部事件化；删除 startAttempted；失效启动必须 settle |
| C | BUG-GSC07/08/09 | 增加原子快照、查询竞争、重复启动与 stale Promise 回归证明 |
| D | 全部 | 对当前工作树重新执行四层验证及真实 Tauri 启动检查 |
| E | BUG-GSC10/11 | 对账离线 runtime；确保 ensure 异常和 stale setup start 均可恢复 |

## 唯一性约束

1. 前端只有 `GatewayConnectionManager.dispatch` 能提交编排状态。
2. UI 和 App 不直接组合 Gateway 进程恢复步骤。
3. Rust canonical 状态字段私有，只有 `GatewayProcess::transition` 能写入 lifecycle/mode。
4. WebSocket 的协议内退避属于传输实现，不得修改 Gateway 进程 canonical 状态。
