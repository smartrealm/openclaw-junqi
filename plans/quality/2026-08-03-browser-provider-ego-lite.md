# 浏览器 Provider 集成实施计划

## 已实施

1. 增加 Rust 只读 `probe_browser_providers` 命令，集中探测官方 `ego-browser` CLI。
2. 增加严格类型的浏览器 Provider 目录、响应解析器和运行时状态 Hook。
3. 新增共享 `BrowserProviderPanel`，接入 Tools 页与 Workbench Browser 标签。
4. 增加中英文与繁体中文资源、解析器回归测试和设计/规格记录。

## 验证顺序

1. 运行浏览器 Provider 单元测试。
2. 运行 TypeScript lint、完整前端测试和生产构建。
3. 运行 `cargo fmt -- --check`、`cargo check --lib` 与 `cargo test --lib`。
4. 在 macOS 安装 ego-lite 后重新检测，确认只显示 CLI 路径，不自动启动浏览器。

## 后续扩展

- 只有在 OpenClaw 或 ego-lite 发布稳定、可验证的控制协议后，才评估在 Browser 标签中展示实时页面或任务空间；届时仍需保留 Gateway/外部应用的授权边界。
