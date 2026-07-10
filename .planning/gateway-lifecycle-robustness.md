# Gateway 生命周期健壮性修复计划

## 执行顺序

| 阶段 | Bug | 文件 | 修复 |
|---|---|---|---|
| A | BUG-GL07 | `src-tauri/src/commands/gateway.rs` | 重启 CLI 失败或超时后先终止并等待，再进入兜底 |
| A | BUG-GL08 | `src-tauri/src/state/gateway_process.rs`、`gateway.rs` | 用重启完成代次区分重复重启与其他操作竞争 |
| B | BUG-GL09 | `src/services/gateway/GatewayConnectionManager.ts`、`GatewayActionExecutor.ts` | 为异步副作用增加生命周期 generation 提交门禁 |
| B | BUG-GL10 | `src/api/tauri-adapter.ts` | 状态轮询改为串行自调度，并丢弃过期结果 |
| C | 全部 | Rust/TypeScript 回归测试 | 每个 Bug 增加能捕获原行为的回归断言 |

## 验证层

1. 清理检查：旧并发轮询与无条件 join 文案不再存在。
2. 接口检查：TypeScript 与 Rust 编译通过。
3. 行为检查：Gateway 定向测试、完整前端测试和 Rust 测试通过。
4. 集成检查：边界检查与生产构建通过。
