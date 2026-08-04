# 浏览器 Provider 与 ego-lite 集成设计

## 依据

- OpenClaw 当前安装版本的 `docs/tools/browser.md`：Gateway 拥有原生浏览器、隔离 profile、标签页和浏览器工具；浏览器是否可用由 Gateway 工具配置决定。
- ego-lite 官方仓库：<https://github.com/citrolabs/ego-lite>
- ego-lite 官方 skill：<https://raw.githubusercontent.com/citrolabs/ego-lite/main/skills/ego-browser/SKILL.md>

官方 skill 的入口是 `ego-browser nodejs`。ego lite 使用独立的 Chromium 应用和隔离 task space；首次引导可以由用户选择是否从 Chrome 或其他浏览器导入登录态。JunQi 不嵌入浏览器页面，也不读取、复制或迁移 profile，而是把用户明确同意后的引导交给官方应用。

## 当前行为

JunQi 已经有 Workbench 的 `browser` 标签、Tools 页和 Chat 顶部状态入口。三处现在共享同一个 Provider 面板和探测服务：OpenClaw 原生浏览器来自当前会话的有效工具，ego-lite 来自本机 CLI 与官方应用路径；首次设置通过确认后的官方应用交接完成。

## 目标行为

1. OpenClaw 原生浏览器继续作为默认 Provider。其状态只来自当前会话的 `tools.effective` 返回值，不通过本机命令探测或静态假设“已就绪”。
2. ego-lite 作为可选外部 Provider。JunQi 只读探测官方 CLI `ego-browser` 和 macOS 官方应用路径，展示平台支持、安装状态和检测到的绝对路径。
3. 探测不启动进程、不读取浏览器 profile、不迁移登录态、不自动安装 skill，不把未知页面伪造成预览内容。
4. 用户可在 Tools、Workbench Browser 或 Chat 顶部入口打开同一个引导对话框。对话框要求用户确认边界后，只打开已检测到的官方应用；安装、首次引导和是否导入登录态由 ego lite 自己处理。
5. Tools 页、Workbench Browser 标签和 Chat 状态入口复用同一 Provider 服务与多语言资源，状态、说明和官方文档入口保持一致。
6. Provider 目录、Tauri 命令返回值和前端解析器全部使用严格类型；新 Provider 只需扩展目录和探测契约，不把供应商逻辑散落到页面。

## 未覆盖边界

- 当前没有把 ego-lite 的真实页面嵌入 Tauri WebView。官方 skill 通过外部 CLI 驱动独立浏览器，OpenClaw 原生浏览器也由 Gateway 管理；在没有经过官方协议验证前，JunQi 不实现自定义 CDP 代理。
- JunQi 不执行远程安装脚本。用户从官方文档完成 `npx skills add citrolabs/ego-lite`，或按官方安装说明安装应用，之后点击重新检测。
- JunQi 不替用户决定是否导入 Chrome 登录态。首次引导中的迁移选项、授权和取消都由 ego lite 官方 UI 展示并记录。
- ego-lite 官方仓库目前声明 macOS 支持；Windows/Linux 显示为不支持，待上游发布正式支持后再更新平台契约。

## 验证

- Rust `probe_browser_providers` 只调用集中式可执行文件和已知应用路径探测，不执行 `ego-browser`。
- Rust `open_ego_lite` 只允许打开 `/Applications/ego lite.app` 或用户 `Applications` 下的同名应用，不接受渲染器传入路径，不通过 shell 启动。
- TypeScript 解析器拒绝未知 Provider、未知状态和缺失必填字段。
- UI 在 Tools 页和 Workbench Browser 标签使用同一 `BrowserProviderPanel`，Chat 顶部只复用状态入口并跳转到该面板。
