# Gateway 生命周期与存储迁移审计

## 严重问题

### BUG-GL01 · 启动、重启、停止和兜底没有共享同一把操作锁

**位置**：`src-tauri/src/commands/gateway.rs`、`src-tauri/src/commands/ensure.rs`、`src-tauri/src/commands/docker.rs`

`restart_gateway` 只有重启专用门闩，`start_gateway`、`ensure_gateway_running`、`stop_gateway` 和 Docker 启动仍可并发。两个启动调用都可能在端口尚未就绪时各自创建子进程。

**影响**：重复进程、遗留 PID、重启打断启动、状态与真实进程不一致。

**修复**：在 `GatewayProcess` 中建立覆盖所有生命周期写操作的异步门闩；公开命令持锁，内部组合函数复用同一所有权上下文。

### BUG-GL02 · 并发 ensure 返回失败而不是等待当前恢复

**位置**：`src-tauri/src/commands/ensure.rs`

静态 `ENSURE_IN_FLIGHT` 在重复调用时返回 `healthy=false`。前端随后会触发 restart，和正在执行的 ensure 竞争。

**影响**：恢复链路自我打断，出现长时间“正在连接”和重复重启。

**修复**：删除独立布尔门闩；并发调用等待全局生命周期操作完成，再重新探测并复用结果。

### BUG-GL03 · Gateway 管理状态只在单个 Tauri 进程内唯一

**位置**：`src-tauri/src/lib.rs`

应用没有 OS 级单实例保护。多个 JunQi 进程会各自创建 `GatewayProcess`。

**影响**：进程级门闩无法阻止跨应用实例的并发操作。

**修复**：启用 Tauri 单实例插件，第二实例只负责唤醒主窗口。

### BUG-GL04 · 系统服务、托管 Child 和 Docker 没有统一所有权

**位置**：`src-tauri/src/state/gateway_process.rs`、`src-tauri/src/commands/gateway.rs`、`src-tauri/src/commands/docker.rs`

当前状态只保存托管 Child；停止和退出不能表达系统服务或 Docker 的所有权。

**影响**：UI 显示与真实运行方式不一致，切换运行模式可能残留旧实例。

**修复**：增加运行模式与完整生命周期状态，并由统一 Supervisor 路径更新。

### BUG-ST01 · 所有路径硬编码到 `~/.openclaw`

**位置**：`src-tauri/src/paths.rs`

状态目录、配置、工作区和 JunQi 管理运行时全部从固定目录派生，无法安全选择或迁移。

**影响**：用户无法指定磁盘；直接移动目录会让 Gateway、LaunchAgent 和桌面应用读写不同位置。

**修复**：在系统应用配置目录保存稳定 bootstrap 文件；所有路径统一从 bootstrap 或显式环境变量解析。

### BUG-ST02 · 迁移期间没有停止写入、校验和回滚

**位置**：当前不存在迁移编排器。

**影响**：会话、认证和配置可能在复制过程中继续变化，造成不完整迁移。

**修复**：迁移必须持有生命周期独占锁，停止所有受管运行方式，复制到目标侧临时目录，校验后原子切换 bootstrap；失败保留源目录并回滚路径。

## 中等问题

### BUG-GL05 · canonical lifecycle、重启限流和启动编排器未接入真实链路

`lifecycle` 只覆盖部分 start 路径；`RestartGovernor`、`should_defer_restart` 和 `startup.rs` 没有形成真实单一入口。

**修复**：所有公开生命周期命令更新统一状态；移除或隔离未接入的伪单一来源。

### BUG-GL06 · TCP 可连接被当成 Gateway 身份

端口探测只能证明有监听者，不能证明它是目标 OpenClaw Gateway。

**修复**：本轮保留 TCP 作为启动就绪下限，同时在状态模型中标记外部未知所有者；后续增加协议级只读身份探测。

## 官方路径约束

OpenClaw 官方 FAQ 规定：状态根目录由 `OPENCLAW_STATE_DIR` 控制，配置可由 `OPENCLAW_CONFIG_PATH` 单独指定，工作区由 `agents.defaults.workspace` 配置。JunQi 的首次启动选择必须同时维护这三个路径的一致性。
