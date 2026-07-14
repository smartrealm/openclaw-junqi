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

## 2026-07-14 复审补充

### BUG-ST03 · 严重 · 未确认 Gateway 停止就复制状态目录

**位置**：`src-tauri/src/commands/storage.rs`

停止命令全部按 best-effort 处理，随后立即复制；如果系统服务、Docker 或外部 Gateway 仍占用端口，会话和认证文件可能在复制期间继续变化。

**修复**：记录迁移前运行模式，停止后等待配置端口可绑定；端口未释放时中止迁移并恢复 canonical 状态，绝不开始复制。

### BUG-ST04 · 严重 · 迁移失败会把原 Gateway 留在停止状态

**位置**：`src-tauri/src/commands/storage.rs`

复制、校验、目标激活或 bootstrap 写入失败会直接返回。源数据仍在，但迁移前正常运行的 Gateway 不会恢复，用户只能离开向导后手工排障。

**修复**：把迁移前运行模式作为事务上下文；失败时按 managed child、Docker 或系统服务原样恢复，并清理尚未提交的目标副本。

### BUG-ST05 · 严重 · workspace 路径补丁失败被静默忽略

**位置**：`src-tauri/src/commands/storage.rs`

迁移后对 `agents.defaults.workspace` 的写入忽略所有读取、解析、序列化和落盘错误。bootstrap 可能已经指向新目录，而 OpenClaw 配置仍指回旧目录。

**修复**：在临时迁移目录激活前完成路径补丁；需要修改时任何错误都使事务失败并清理临时目录。

### BUG-ST06 · 严重 · Windows 无法可靠覆盖已有 bootstrap

**位置**：`src-tauri/src/paths.rs`

bootstrap 使用 `std::fs::rename(temp, existing)` 覆盖。Unix 支持该语义，但 Windows 对已存在目标通常返回错误，导致第二次切换或回滚失败。

**修复**：写入并同步临时文件；Unix 使用 rename，Windows 使用 `MoveFileExW` 的 replace-existing 与 write-through 标志。

### BUG-ST07 · 中等 · 迁移进度固定为中文

**位置**：`src-tauri/src/commands/storage.rs`、`src/components/setup/StorageSetupGate.tsx`

Rust 事件直接发送中文句子，英文和阿拉伯语界面迁移时仍显示中文。

**修复**：事件发送稳定翻译 key 和兜底文本，前端使用当前 i18n 实例解析。

### BUG-ST08 · 严重 · 符号链接状态根可能反写源目录

**位置**：`src-tauri/src/commands/storage.rs`

复制器会保留符号链接。如果状态根目录本身是链接，临时迁移目录也会成为指向源目录的链接，随后 workspace 配置补丁可能直接修改源配置。

**修复**：仅解析状态根链接后复制其实际内容，目录内部链接仍按原样保留；逻辑路径和规范路径都可识别为状态目录内部 workspace。

## 官方路径约束

OpenClaw 官方 FAQ 规定：状态根目录由 `OPENCLAW_STATE_DIR` 控制，配置可由 `OPENCLAW_CONFIG_PATH` 单独指定，工作区由 `agents.defaults.workspace` 配置。JunQi 的首次启动选择必须同时维护这三个路径的一致性。
