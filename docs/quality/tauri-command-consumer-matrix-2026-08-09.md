# Tauri Command 消费者矩阵

日期：2026-08-09

## 目的

Tauri command 是桌面 WebView 可调用的权限边界，不应把 Rust 内部函数、历史页面入口或调试工具继续暴露给
渲染层。本矩阵只依据当前仓库可复现的注册表、源码引用和 Rust 调用图，不以未来功能或测试名称推测消费者。

## 采集方法

1. 从 `src-tauri/src/lib.rs` 的 `tauri::generate_handler!` 解析基线 295 个注册 command。
2. 扫描 `src/` 与 `packages/` 下 971 个非测试 TypeScript、TSX 源文件的 command 字符串。
3. 对未发现 WebView 字符串消费者的项，继续核对 Rust 函数调用、Tauri 注入脚本、测试、插件清单、文档、
   capability 配置和目标平台分支。
4. 只删除同时满足“没有 WebView 消费者、没有 Rust 业务调用，或仅有可去除的历史测试消费者”的 command；
   Rust 内部仍需调用的函数只取消 `#[tauri::command]` 和注册，不删除函数。

## 结果

清理后注册表有 272 个 command：271 个由生产 TypeScript 或 TSX 字符串消费者引用，另 1 个
`return_to_desktop` 由 `src-tauri/src/commands/console.rs` 注入的控制页脚本调用。没有无消费者的 Tauri
command 留在注册表。

| 基线 command | 处理 | 证据 |
| --- | --- | --- |
| `open_quickchat_with_files` | 取消 Tauri 暴露，保留 Rust 函数 | `ResourceDropCoordinator::drop` 调用该函数创建文件投放窗口；无 WebView 直接调用。 |
| `toggle_dynamic_island` | 取消 Tauri 暴露，保留 Rust 函数 | 原生托盘菜单调用；无 WebView 直接调用。 |
| `return_to_desktop` | 保留 | 控制 UI 的 Rust 注入脚本调用，属于真实 WebView 消费者。 |
| `get_quickchat_visible`、`get_dynamic_island_visible`、`reposition_dynamic_island` | 删除实现与注册 | 无 WebView、Rust、插件、测试或配置消费者。 |
| `terminal_create`、`terminal_write`、`terminal_resize`、`terminal_kill` | 删除旧 PTY 模块与注册 | 当前终端使用 `pty_neu` 和工作台 PTY 边界；旧模块无任何调用方。 |
| `get_terminal_integration_status` | 删除实现与注册 | 设置流程只调用具备实际副作用和真实状态返回的 `apply_terminal_integration`；旧查询入口无消费者。 |
| `git_create_branch` | 删除实现与注册 | 无前端菜单、快捷操作、工作台或 Rust 调用方。 |
| `list_directory` | 删除实现、返回类型与注册 | 工作区文件统一经范围受控的 `fs_neu` 与 `workspace-files` 边界读取；旧路径无消费者。 |
| `prepare_builtin_skill` | 删除实现、返回类型与注册 | 会话实际使用 `install_builtin_skill_for_chat`；旧预处理命令无消费者。 |
| `save_app_settings`、`detect_agent_paths` | 删除实现与注册 | 当前设置按专用 command 更新；旧整包写入和路径探测入口无消费者。 |
| `write_project_config` | 删除实现与注册，并删除仅服务它的原子写入测试 | 生产仅读取项目配置；唯一引用是测试辅助，已由测试内配置夹具替代。 |
| `get_agent_config_file_path`、`read_agent_config_file`、`write_agent_config_file` | 删除实现、路径辅助与注册 | 无前端或 Rust 消费者。 |
| `screenshot_check_permission` | 删除平台分支与注册 | 截图交互、全屏和窗口列举各自返回官方系统结果；独立权限探测无消费者。 |
| `stop_docker_gateway` | 删除外层 command 与注册 | 运行时通过统一 `stop_gateway` 及内部锁定函数停止 Docker；旧包装无消费者。 |
| `voice_is_recording` | 删除实现与注册 | 录音生命周期以开始、停止结果为准；独立轮询无消费者。 |
| `write_models_log` | 删除实现与注册 | 无消费者，且仅向临时目录写调试内容。 |

## 验证与边界

- 已通过 `cargo fmt -- --check`、`cargo check --lib`、两个受影响项目配置回归测试和 `git diff --check`。
- 本矩阵只能证明当前源树的消费者关系，不证明第三方 WebView、开发者控制台或未打包脚本可以继续调用已删除
  command；这些并非 JunQi 支持的公开 API。
- Windows、macOS 和 Linux 的真实窗口、终端、截图与托盘行为仍需在各平台实际验证。
