# 工作台可靠性审计

日期：2026-07-29

范围：AI 工作台文件编辑、智能体展开工作区、任务工作树、底部终端和工作台可见文案。

## 结论

静态检查和既有源码断言通过不能证明工作台状态链可靠。当前存在编辑器卸载保存竞态、清理失败后状态提前提交、工作树终端目录错误和工作区切换不可重试等跨组件问题。

## 已确认问题

### BUG-WS-01 · CRITICAL：文件页签切换重建整个编辑器

`AgentWorkspace` 用活动文件路径作为内容场景 key。切换页签会卸载整个 `FileViewer`，触发不等待结果的卸载保存，并重置光标、预览模式和目录状态。

### BUG-WS-02 · CRITICAL：离开编辑器前没有统一完成保存事务

关闭单个/批量页签、返回任务、新建任务和项目切换直接更新 UI 状态。即使调用 `flushPath`，磁盘基线过期后仍可能以 resolved Promise 返回，而文档仍为脏或冲突状态。

### BUG-WS-03 · CRITICAL：工作树和任务清理失败后仍删除前端状态

合并后的工作树删除失败会被吞掉并标记为已丢弃；删除任务时，取消进程或删除工作树失败后仍会移除持久化任务。

### BUG-WS-04 · CRITICAL：工作树终端可能继续使用主仓 cwd

“工作树终端”只显示已有项目终端。终端恢复的 shell cwd 优先于新的 worktree 路径，用户可能在主仓执行原本准备在工作树执行的命令。

### BUG-WS-05 · MEDIUM：工作区切换保存失败后不能原地重试

根目录切换在 flush 失败后直接退出。用户解决冲突后依赖项没有变化，目标根目录不会再次应用。

### BUG-WS-06 · MEDIUM：工作台可见文案绕过应用 i18n

文件树、任务运行视图和工作台导航仍有硬编码中文，英文界面会混入中文，并与已有三套 locale 契约不一致。

### BUG-TERM-01 · HIGH：终端恢复默认会提交部分状态

设置页先重置前端 store 和多个 localStorage 偏好，再并行写入两个原生字段。任一原生写入失败时，界面已经变化，原生设置也可能只更新一个字段，错误提示无法代表一个明确状态。

### BUG-TERM-02 · HIGH：迟到的 PTY 打开结果可能泄漏后台进程

终端在 `open_shell` 尚未返回时卸载，会先调用一次 `kill_shell`。如果原生 PTY 在该调用之后才注册，旧实现收到结果后只因组件已清理而退出，不会再次终止刚创建的 PTY。

### BUG-WS-07 · HIGH：Windows 工作台会话持久化被目录同步阻断

Durable Session 在替换会话文件后无条件以普通文件方式打开父目录并调用 `sync_all`。Windows x64 与 x86 CI 均稳定返回 `Access is denied (os error 5)`，使保存、备份恢复和重置全部失败。Microsoft 的 `CreateFileW` 契约要求目录句柄使用 `FILE_FLAG_BACKUP_SEMANTICS`，而 `FlushFileBuffers` 没有承诺目录句柄具备 POSIX 目录 `fsync` 语义，因此不能把 Unix 目录同步流程直接移植到 Windows。

## 修复结论

- 文件场景改为项目级稳定 key；所有移除编辑视图的入口先等待保存屏障，保存冲突继续保留当前 UI。
- 任务与工作树仅在清理成功后提交前端删除状态；Rust 工作树清理支持成功后的幂等重试。
- 工作树终端显式传递目录，并复用同目录 shell 或创建新 shell。
- 工作区切换失败保留目标并提供重试；工作台新增文案覆盖 `zh`、`zh-TW`、`en`。
- 终端恢复默认通过单个原生命令更新两个原生字段，成功后才提交全部前端偏好。
- PTY 打开结果按清理状态和 run-id 判定接管或终止，迟到结果不会留在后台。
- Durable Session 已拆为命令契约、持久化事务和回归测试三个模块。会话文件和备份在所有平台均以可写句柄执行 `sync_all`；Unix 继续同步父目录，Windows 使用 `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)` 完成替换，不再执行没有官方契约支撑的目录 flush。

## 验证边界

修复必须覆盖行为测试、TypeScript/模块边界、完整前端测试、生产构建、Rust library 检查和 `git diff --check`。未启动实际 Tauri 窗口前不得声称真机交互通过。

## 验证结果

2026-07-29 已执行：

- 工作台与终端定向测试：78 项通过，0 失败。
- `pnpm lint`：通过，模块边界检查覆盖 613 个文件。
- `pnpm test`：前端 1820 项、脚本 223 项全部通过；仅输出项目既有的 Node `module.register` 弃用提示和 Radix SSR `useLayoutEffect` 警告。
- `pnpm build`：通过；collaboration package contract、TypeScript 和 Vite production build 均成功，未报告循环分包或 chunk 预算失败。
- `cargo fmt --all -- --check`、`cargo check --all-targets`、`cargo clippy --all-targets`：通过；clippy 仅保留 5 项本任务外既有警告。
- `cargo test --lib --no-fail-fast`：648 项通过，0 失败，3 项按环境要求忽略。
- `git diff --check`：通过。

未执行实际 Tauri 桌面窗口交互，因此文件冲突横幅、工作树终端真实 cwd、终端设置失败提示和 PTY 进程列表仍属于真机走查边界。

### Windows CI 追加验证

- 首次 main CI `30412281113`：前端、脚本、Linux Rust 全部通过；Windows x64/x86 各有 4 个 Durable Session 测试因目录打开被拒绝而失败。
- 第二次 main CI `30413334628`：Windows 条件代码编译通过，首次写入测试通过；后续三项测试证明备份仍用只读句柄调用 `FlushFileBuffers`，Windows x64 返回 access denied。备份同步句柄据此收紧为写权限。
- 修复后的本地 Durable Session 定向测试：4 项通过，0 失败。
- 第三次 main CI `30413681291`：Windows x64、Windows x86、Linux Rust、前端构建、类型检查、lint、桌面测试和 collaboration 测试全部通过；同一组 Durable Session 回归已在两个 Windows 架构原生执行。
- daxia CI `30413681394`：前端、Linux Rust、桌面和 collaboration 测试全部通过；该分支工作流按既有条件跳过 Windows 矩阵。

平台依据：[CreateFileW](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-createfilew)、[FlushFileBuffers](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)。
