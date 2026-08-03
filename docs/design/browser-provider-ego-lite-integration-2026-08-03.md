# 浏览器 Provider 与 ego-lite 集成设计

## 依据

- OpenClaw 当前安装版本的 `docs/tools/browser.md`：Gateway 拥有原生浏览器、隔离 profile、标签页和浏览器工具；浏览器是否可用由 Gateway 工具配置决定。
- ego-lite 官方仓库：<https://github.com/citrolabs/ego-lite>
- ego-lite 官方 skill：<https://raw.githubusercontent.com/citrolabs/ego-lite/main/skills/ego-browser/SKILL.md>

官方 skill 的入口是 `ego-browser nodejs`。它通过独立的 Chromium 应用和 task space 复用登录状态，但不会把浏览器页面嵌入 JunQi，也不应由 JunQi 在没有明确授权时迁移 profile 或启动自动化。

## 当前行为

JunQi 已经有 Workbench 的 `browser` 标签和 Tools 页，但前者是占位面板，后者的 `browser` 仅存在于静态工具目录。两者不能反映当前 Gateway 工具权限，也不能告诉用户可选的外部浏览器是否可用。

## 目标行为

1. OpenClaw 原生浏览器继续作为默认 Provider。其状态只来自当前会话的 `tools.effective` 返回值，不通过本机命令探测或静态假设“已就绪”。
2. ego-lite 作为可选外部 Provider。JunQi 只读探测官方 CLI `ego-browser`，展示平台支持、安装状态和检测到的绝对路径。
3. 探测不启动进程、不读取浏览器 profile、不迁移登录态、不自动安装 skill，不把未知页面伪造成预览内容。
4. Tools 页和 Workbench Browser 标签复用同一个 Provider 面板，状态、说明和官方文档入口保持一致。
5. Provider 目录、Tauri 命令返回值和前端解析器全部使用严格类型；新 Provider 只需扩展目录和探测契约，不把供应商逻辑散落到页面。

## 未覆盖边界

- 当前没有把 ego-lite 的真实页面嵌入 Tauri WebView。官方 skill 通过外部 CLI 驱动独立浏览器，OpenClaw 原生浏览器也由 Gateway 管理；在没有经过官方协议验证前，JunQi 不实现自定义 CDP 代理。
- 当前未提供自动安装按钮。用户可从官方文档或复制官方 `npx skills add citrolabs/ego-lite` 命令完成安装，之后点击重新检测。
- ego-lite 官方仓库目前声明 macOS 支持；Windows/Linux 显示为不支持，待上游发布正式支持后再更新平台契约。

## 验证

- Rust `probe_browser_providers` 只调用集中式可执行文件探测，不执行 `ego-browser`。
- TypeScript 解析器拒绝未知 Provider、未知状态和缺失必填字段。
- UI 在 Tools 页和 Workbench Browser 标签使用同一 `BrowserProviderPanel`。
