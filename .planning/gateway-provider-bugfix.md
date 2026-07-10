# Gateway 与供应方配置修复计划

## 执行顺序

| 阶段 | Bug | 文件 | 修复 |
| --- | --- | --- | --- |
| A | BUG-01 | `src-tauri/src/commands/ensure.rs` | 原生启动优先于 Docker 兜底 |
| A | BUG-02 | `src-tauri/src/commands/gateway.rs` | 服务重启失败后回退托管进程 |
| B | BUG-03 | Gateway 前端状态链路 | 贯通日志查询、快照和启动面板 |
| C | BUG-04 | `runtimeNormalization.ts` | 补齐供应方缺失模型声明 |
| D | 全部 | 测试与构建 | 前端、Rust、CLI 健康检查和桌面打包 |
