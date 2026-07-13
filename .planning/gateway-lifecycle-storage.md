# Gateway 生命周期与存储迁移执行计划

## Phase A：并发与唯一性

| Bug | 文件 | 实施 |
| --- | --- | --- |
| BUG-GL01 | `gateway_process.rs`、`gateway.rs`、`ensure.rs`、`docker.rs` | 建立全生命周期异步门闩，拆分公开持锁函数与内部组合函数 |
| BUG-GL02 | `ensure.rs` | 删除失败式布尔防重，等待当前操作并复用健康结果 |
| BUG-GL03 | `Cargo.toml`、`lib.rs` | 启用应用单实例并唤醒已有主窗口 |

## Phase B：所有权状态

| Bug | 文件 | 实施 |
| --- | --- | --- |
| BUG-GL04 | `gateway_process.rs`、生命周期命令 | 记录 `none/external/system_service/managed_child/docker` 模式 |
| BUG-GL05 | 生命周期命令 | start/restart/stop/ensure/docker 全部维护 canonical lifecycle |

## Phase C：路径与迁移

| Bug | 文件 | 实施 |
| --- | --- | --- |
| BUG-ST01 | `paths.rs`、新存储命令 | 固定 bootstrap + 动态状态/配置/工作区解析 |
| BUG-ST02 | 新迁移模块 | 停止写入、临时复制、校验、原子切换与失败回滚 |

## Phase D：首次启动 UI

- 在欢迎页完成运行时检测后、执行安装前显示存储位置选择。
- 检测旧 `~/.openclaw` 后明确询问继续使用、迁移或创建新环境。
- 根据检测结果在存储步骤后继续到运行方式选择、Gateway 启动或就绪页。
- 目录选择结果和迁移进度由 Rust 返回，不在前端自行复制文件。

## Phase E：验证

- Rust：门闩唯一所有者、bootstrap 优先级、迁移校验与失败不切换。
- 前端：首次启动门禁、迁移参数和已配置时直接进入。
- 完整 `cargo test --lib`、前端测试、生产构建、格式检查。

## Phase F：2026-07-14 事务安全复审

| Bug | 文件 | 实施 |
| --- | --- | --- |
| BUG-ST03 | `storage.rs` | 停止后等待端口释放，未释放则禁止复制 |
| BUG-ST04 | `storage.rs` | 记录原运行模式，失败时恢复 Gateway 并清理目标 |
| BUG-ST05 | `storage.rs` | 临时目录激活前可靠更新 workspace 路径 |
| BUG-ST06 | `paths.rs`、`Cargo.toml` | Windows 原子替换已有 bootstrap |
| BUG-ST07 | `storage.rs`、`StorageSetupGate.tsx`、locales | 结构化多语言迁移进度 |
| BUG-ST08 | `storage.rs` | 解引用状态根链接后复制，禁止迁移补丁反写源目录 |
