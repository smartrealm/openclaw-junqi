# PTY 锁毒化加固记录

## 依据

2026-07-31 的全量审计发现，`agent_task_pty.rs` 和 `terminal.rs` 的高频 PTY 注册表、任务状态和子进程句柄路径存在 `Mutex::lock().unwrap()`。如果线程在持锁期间 panic，Rust 会将锁标记为 poisoned；后续任何读写、清理或重启 PTY 的调用都会再次 panic，导致该子系统只能依靠重启桌面应用恢复。

## 当前行为

- 两个模块都使用 `lock_or_recover`，在锁 poisoned 时取回内部数据并继续执行。
- Agent 任务的注册表、取消/完成状态、输出快照、writer、child 和 master 句柄均经过该边界。
- 集成终端的注册表、会话句柄、PTY master 和 child 句柄均经过该边界。
- 现有命令返回的业务错误仍按原有语义返回；本次没有把锁异常静默转换为成功。

## 验证结果

- `cargo fmt -- --check` 通过。
- `cargo check --lib` 通过。
- `cargo test --lib commands::agent_task_pty`：17 项通过。
- `cargo test --lib commands::terminal`：51 项通过。
- 新增测试验证 poisoned 注册表锁恢复后仍可读取空状态。

## 未验证边界

- 当前主机为 macOS，未在 Windows PTY、PowerShell、ConPTY 或用户权限环境中进行真机验证。
- 其他 Rust 模块仍可能存在独立的 `unwrap`/`expect` 锁路径，不应将本记录解读为全仓锁毒性清零。
