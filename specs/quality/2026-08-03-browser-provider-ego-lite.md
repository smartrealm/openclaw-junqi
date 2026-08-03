# 浏览器 Provider 与 ego-lite 验收规格

## 问题

JunQi 的 Workbench Browser 标签没有运行时来源，Tools 页的浏览器条目也不能区分 OpenClaw 原生工具和外部浏览器 skill。用户无法判断当前会话能否调用浏览器，也无法知道 ego-lite 是否已经安装。

## 约束

- OpenClaw Gateway 是原生浏览器能力的权威来源。
- ego-lite 是独立应用与官方 skill，不是 JunQi 内置浏览器内核。
- 探测必须只读，不能执行安装、启动或 profile 迁移。
- Provider 状态和文案必须经过多语言资源，禁止在组件中写死可见文案。
- 不得使用 `any`、静默默认值或不受约束的动态 IPC 返回值。

## 验收条件

- [ ] Tools 页显示 OpenClaw 原生浏览器和 ego-lite 两个 Provider。
- [ ] OpenClaw 状态由当前会话 `tools.effective` 中的 `browser` 工具计算。
- [ ] ego-lite 状态由 `probe_browser_providers` 返回的 `ego-browser` 可执行文件和平台门禁计算。
- [ ] macOS 未安装时可复制官方安装命令并打开官方文档；不会自动执行命令。
- [ ] 非 macOS 不显示“可用”，而是明确显示平台不支持。
- [ ] Workbench Browser 标签不再展示模拟页面或“可用”的虚假状态，而是复用 Provider 面板。
- [ ] 中文、英文和繁体中文均有完整文案。
- [ ] 相关解析器和 Tauri 命令回归测试通过。

## 未验证事项

- 需要在真实 macOS 机器上安装 ego-lite 后验证 CLI 路径探测。
- 需要在真实 Gateway 配置中启用/禁用 browser 工具，验证 `tools.effective` 状态投影。
