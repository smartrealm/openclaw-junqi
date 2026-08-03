# Collaboration Bootstrap Agent Policy 子域拆分

日期：2026-08-03

## 依据

- OpenClaw 当前配置结构中的 `agents.list`、`agents.defaults.subagents` 和 entry-level `subagents.allowAgents`。
- JunQi 协作配置要求 coordinator 必须来自已配置 Agent，并且插件白名单必须显式、非通配符。
- FCA-14 要求内部拆分不改变 Tauri command、wire contract、运行时所有权和秘密边界。

## 本次实现

- 新增 `src-tauri/src/commands/collaboration_bootstrap/agent_policy.rs`。
- 将 Agent ID 规范化、`agents.list` 严格解析、显式白名单校验、继承策略求值和 coordinator policy 扩展迁移到该模块。
- `collaboration_bootstrap.rs` 只保留配置读取、批量写入和 readback；原有调用继续使用同一策略函数和错误码。
- 未放宽 wildcard、重复 ID、未配置 Agent 或 coordinator 不在白名单时的失败关闭行为。

## 验证

- `cargo fmt -- --check`：通过。
- `cargo check --lib`：通过。
- `cargo test --lib commands::collaboration_bootstrap`：52 项通过。

## 未验证边界

- 未连接真实 Gateway 执行配置写入；CLI dry-run、写入和 readback 仍只由既有测试覆盖。
- 未在 Windows 或 Linux 目标上执行真实 OpenClaw CLI 配置流程。
- package/storage、journal/plugin、recovery 子域仍未拆分，FCA-14 仍进行中。
