# 安装诊断完整性执行计划

## 执行顺序

### Phase A - 防止静默丢失

| Bug | 文件 | 修复 |
|---|---|---|
| BUG-INSTALL-LOG-06 | `src-tauri/src/commands/setup_diagnostics.rs` | 当前安装会话改为独立目录，禁止会话内覆盖早期日志，仅在新会话开始时按完整目录清理旧会话。 |
| BUG-INSTALL-LOG-07 | `src-tauri/src/commands/setup_diagnostics.rs` | 步骤重试追加 attempt 边界，不再截断上一次尝试。 |
| BUG-INSTALL-LOG-08 | `src-tauri/src/commands/setup_diagnostics.rs` | 写盘错误只上报一次到安装控制台，不再用 `let _ =` 静默吞掉。 |

### Phase B - 进程级取证

| Bug | 文件 | 修复 |
|---|---|---|
| BUG-INSTALL-LOG-09 | `src-tauri/src/commands/setup.rs`、`gateway.rs` | npm、winget、Gateway 的 stdout/stderr 通过共享脱敏写入器逐行持久化。 |
| BUG-INSTALL-LOG-10 | `src-tauri/src/commands/setup.rs` | 记录外部进程启动、PID、退出状态与耗时；保留 MSI/Inno 原生日志。 |

### Phase C - 交付与导出

| Bug | 文件 | 修复 |
|---|---|---|
| BUG-INSTALL-LOG-11 | `setup_diagnostics.rs`、`SetupFlowPanels.tsx` | 将诊断目录安全导出为 ZIP，并提供本地化界面入口。 |

## 验证

- [x] Rust 格式、Clippy、check、库测试（480 通过，2 个环境测试忽略）。
- [x] 前端类型检查、回归测试和生产构建（920 + 30 通过）。
- [x] Windows winget/MSI/Inno 源码契约回归。
- [x] 日志会话、重试保留、脱敏和 ZIP 路径安全的行为测试。
- [ ] GitHub Windows MSVC 原生编译与 NSIS 打包（推送 `daxia` 后由 CI 验证）。
