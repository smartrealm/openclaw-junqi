# 工作台可靠性实施计划

日期：2026-07-29

## 执行顺序

| 阶段 | 问题 | 文件 | 修复 |
| --- | --- | --- | --- |
| A | BUG-WS-01 | `AgentWorkspace/index.tsx` | 稳定文件场景 key，避免页签切换重挂载 |
| A | BUG-WS-02 | `FileViewer.tsx`、`useFilePreviewDocument.ts`、工作台调用方 | 提取异步页签关闭事务并验证 flush 后状态 |
| B | BUG-WS-03 | `AgentRunView.tsx`、`AgentWorkspace/index.tsx` | 清理成功后再提交状态 |
| B | BUG-WS-04 | `AgentRunView.tsx`、`AgentWorkspace/index.tsx`、终端组件 | 显式路由工作树 cwd |
| C | BUG-WS-05 | `WorkspacePanel.tsx` | 保留待切换目标并提供重试 |
| C | BUG-WS-06 | 工作台组件、三套 locale | 删除硬编码用户文案 |
| D | BUG-TERM-01 | `TerminalSettingsPanel.tsx`、`app_settings.rs`、`lib.rs` | 原生一次提交，成功后提交本地默认值 |
| D | BUG-TERM-02 | `ShellTerminalPanel.tsx`、`shellLifecycle.ts` | 迟到或异常 PTY 打开结果主动终止 |
| E | BUG-WS-07 | `workbench_session.rs`、`workbench_session/storage.rs`、`storage_tests.rs` | 分离命令/事务/测试，按 Unix/Windows 官方持久化能力实现文件替换 |
| F | BUG-TERM-03 | `workbench_pty.rs`、`workbench_pty/runtime.rs`、`model.rs`、`tests.rs` | 全量尝试退出清理，并拆分命令、运行时、协议与测试职责 |

## 验证

- 每个 BUG 至少一条能覆盖原失败路径的回归测试。
- 运行定向测试、`pnpm lint`、`pnpm test`、`pnpm build` 和 `git diff --check`。
- 运行 `cargo fmt -- --check`、`cargo check --lib` 和 `cargo test --lib`，核对新增 command 注册。
- main CI 必须在 Windows x64、x86 原生执行同一组 Durable Session 回归，不能用本机 macOS 结果替代。

## 回滚边界

不迁移持久化格式，不改变 Gateway/OpenClaw 协议。失败时可按 BUG 编号独立回滚对应前端行为。

## 完成状态

阶段 A-F 的代码、文档和自动化验证均已完成。main CI `30413681291` 已在 Windows x64、x86 原生通过 Durable Session 回归，daxia CI `30413681394` 亦通过其完整矩阵；BUG-TERM-03 的最终分支 CI 以对应提交记录为准。真实 Tauri 桌面交互未执行，保留为人工验收项。
