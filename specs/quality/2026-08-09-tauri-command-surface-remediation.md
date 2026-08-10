# Tauri Command 最小暴露面整改规格

日期：2026-08-09

## 目标

让 `tauri::generate_handler!` 只保留当前 JunQi 渲染层或受控 Rust 注入页真实使用的 command。Rust 内部调用不应因
函数曾经带有 `#[tauri::command]` 而继续向 WebView 暴露；无消费者的历史命令、测试和专属类型必须在同一变更中删除。

## 行为约束

1. 注册 command 必须有当前生产 WebView 字符串调用，或有可定位的受控 Rust 注入脚本调用。
2. Rust 内部业务函数可以保留普通函数签名，但不得继续注册为 command。
3. 删除旧 PTY 后，当前终端仅保留 `pty_neu`、工作台 PTY 与其现有 Tauri 边界。
4. 文件树、Docker 停止、技能安装、设置、项目配置、截图和录音必须继续通过已有真实消费者使用的边界工作；
   不增加 fallback 或替代命令。
5. 任何只测试被移除实现本身的测试与其辅助函数一并删除；保留仍覆盖生产读取或行为的测试。

## 非目标

- 不把 Tauri command 当作对外兼容 API。
- 不为可能存在的开发者控制台、旧版 WebView 或未来界面保留兼容 command。
- 不改变 OpenClaw Gateway RPC、运行时语义或插件协议。

## 验收

- 当前注册表的每项都能在生产 WebView 或受控 Rust 注入路径找到消费者。
- 删除项不存在于注册表、插件清单、capability、生产前端、Rust 业务路径和有效测试中。
- Rust 库检查与受影响的项目配置测试通过。
- 完整前端、完整 Rust、构建和目标平台验证在后续验证阶段执行并如实记录。
