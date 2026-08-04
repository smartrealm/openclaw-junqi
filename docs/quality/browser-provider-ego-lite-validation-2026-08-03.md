# 浏览器 Provider 与 ego-lite 验证记录

## 变更范围

- `probe_browser_providers` 只读探测官方 `ego-browser` CLI 和已知应用路径。
- `open_ego_lite` 只在用户完成边界确认后打开固定的官方应用路径；登录态迁移仍由 ego lite 官方首次引导处理。
- OpenClaw 原生浏览器状态来自当前会话 `tools.effective`。
- Tools 页和 Workbench Browser 标签共享 `BrowserProviderPanel`。
- 中文、英文和繁体中文资源已同步。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| 浏览器 Provider TypeScript 测试 | 通过，4 项 |
| `pnpm lint` | 通过，边界、版本和 TypeScript 检查均通过 |
| `pnpm test` | 通过，245 项 |
| `pnpm build` | 通过，Vite 生产构建完成 |
| `cargo fmt -- --check` | 通过 |
| `cargo check --lib` | 通过 |
| `cargo test --lib` | 通过，713 项，4 项忽略 |
| `git diff --check` | 通过 |
| Emoji 扫描 | 通过，未发现匹配项 |

## 尚未验证

- 尚未在真实 macOS 设备安装 ego-lite 并验证 `ego-browser` 与应用路径的实际发现。
- 尚未在真实 macOS 设备完成官方 onboarding，验证导入登录态与拒绝导入的结果。
- 尚未在真实 Gateway 中分别启用和禁用 browser 工具验证 UI 状态变化。
- 未实现外部浏览器页面嵌入；该能力需要上游稳定、可验证的控制协议，不能用模拟页面替代。
