# Collaboration Bootstrap Agent Policy 子域拆分计划

日期：2026-08-03

1. [x] 清点 Agent registry、白名单和 coordinator policy 的调用点。
2. [x] 将纯策略解析和校验迁移到 `commands/collaboration_bootstrap/agent_policy.rs`。
3. [x] 保持配置读取、dry-run、写入和 readback 的父模块边界不变。
4. [x] 运行协作启动定向测试、Rust 格式检查和库编译。
5. [ ] 继续拆分 package/storage、journal/plugin 和 recovery 子域。

## 停止条件

如果迁移导致 OpenClaw agents 配置字段、错误码、白名单语义或配置写入顺序变化，停止拆分并保留原实现，不生成猜测性兼容逻辑。
