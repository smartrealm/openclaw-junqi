# 浏览器 Provider 集成实施计划

## 已实施

1. 增加 Rust 只读 `probe_browser_providers` 命令，集中探测官方 `ego-browser` CLI 与已知应用路径；增加只打开已知官方应用的 `open_ego_lite` 命令。
2. 增加严格类型的浏览器 Provider 目录、响应解析器和运行时状态 Hook。
3. 新增共享 `BrowserProviderPanel` 与 ego-lite 设置对话框，接入 Tools 页与 Workbench Browser 标签；Chat 顶部复用状态入口。
4. 增加中英文与繁体中文资源、解析器和 Tauri 注册回归测试，以及设计/规格记录。

## 验证顺序

1. 运行浏览器 Provider 单元测试。
2. 运行 TypeScript lint、完整前端测试和生产构建。
3. 运行 `cargo fmt -- --check`、`cargo check --lib` 与 `cargo test --lib`。
4. 在 macOS 安装 ego-lite 后重新检测，确认 CLI 与应用路径均可见；首次引导中的登录态选择由官方 UI 完成。

## 后续扩展

- 只有在 OpenClaw 或 ego-lite 发布稳定、可验证的控制协议后，才评估在 Browser 标签中展示实时页面或任务空间；届时仍需保留 Gateway/外部应用的授权边界。
