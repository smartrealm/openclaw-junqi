# 萌宠跨平台表面审查

审查日期：2026-07-16

范围：萌宠窗口创建、移动、状态事件、壁纸可读性采样、macOS / Windows 透明渲染能力。

## 已验证

- 采样路径为：`PetWindow.tsx` 事件防抖 → `get_pet_backdrop_reading` →
  `PetWindowGeometry` → 平台采样器 → 派生亮度/对比度；原始桌面像素不经 IPC。
- macOS 不再创建临时截图文件，改由 CoreGraphics 内存图像读取；Windows 使用
  Desktop DC 的内存位图。
- 萌宠贴近左边缘时，采样区切换到右侧，不会再读取萌宠自身的透明背景。
- Rust 全量测试 361 项、前端测试 814 项与脚本测试 27 项通过；TypeScript
  类型检查、模块边界检查、生产构建通过。

## 未通过发布门槛的问题

### BUG-PS-01 · 严重 - Windows 7 不能作为当前发行通道的支持目标

**位置**：`src-tauri/src/commands/pet.rs:50`

**证据**：`open_pet_window` 对所有 Windows 版本无条件创建
`WebviewWindowBuilder(...).transparent(true)`。Windows 7 的 WebView 透明合成不可靠，
这正是黑色矩形边框的根因。更根本的是，JunQi 以 Tauri/WebView2 为应用宿主；Microsoft
将 WebView2 的生命周期绑定 Edge，而 Edge 109 是 Windows 7 的最后版本，支持已于 2023 年
2 月结束。

**影响**：Windows 7 用户仍会遇到黑框；即使只替换萌宠为原生窗口，也不能使主应用的
WebView2 运行时恢复为受支持、安全的配置。

**目标**：当前发布通道明确要求 Windows 10+。若业务必须继续支持 Win7，需单独批准一条
旧版、安全例外发行线：冻结兼容 WebView2、为整套宿主而非仅萌宠维护兼容矩阵，并承担
已终止安全支持的风险；不得将其混入当前稳定版。

### BUG-PS-02 · 中等 - macOS 捕获格式尚未显式归一化

**位置**：`src-tauri/src/commands/pet_backdrop.rs:217`

**证据**：CoreGraphics 图像目前只校验 `32bpp / 8bpc` 后按 BGRA 解读。不同显示器或
色彩空间可能提供不同字节序；虽然不会泄露像素，但会让亮度判断偏移。

**目标**：在 macOS 后端使用固定的 sRGB、32-bit BGRA bitmap context 归一化源图像后
再计算亮度；为非预期图像格式返回 `unavailable`，而不是猜测。

### BUG-PS-03 · 中等 - 屏幕录制授权没有用户可控入口

**位置**：`src/pet/PetWindow.tsx:164`、`src-tauri/src/commands/pet_backdrop.rs:201`

**证据**：后台刷新只会预检权限并静默降级，用户无法从萌宠设置明确启用/关闭动态
可读性，也没有跳转系统设置的恢复动作。

**目标**：在萌宠设置提供“根据桌面自动调整文字对比度”开关与权限状态；仅在启用后
采样，拒绝后显示可恢复说明，不在后台循环中弹出系统授权框。

## 全局质量门禁

`cargo clippy --lib --tests -- -D warnings` 当前未通过。新增采样模块已清零自身告警；
其余问题为既有代码债务，主要包括：

| 类别 | 位置示例 | 处理原则 |
| --- | --- | --- |
| 废弃 API | `commands/provider_oauth.rs` | 迁移到 `tauri-plugin-opener`，不压制 warning。 |
| 未接入或死代码 | `app_settings.rs`、`git_runtime.rs`、`gateway_supervisor.rs` | 接入真实调用链或删除，禁止 blanket allow。 |
| 风格/可维护性 | `cli_tools.rs`、`gateway_rescue.rs`、`docker.rs` | 独立规范化提交，不与平台表面改造混合。 |
| 职责过重 | `src/pet/PetWindow.tsx` | 拆分为事件桥、拖拽控制器、可读性控制器和纯视图。 |
| UI 测试强度 | `src/pet/petWindowRegression.test.ts` | 源码正则测试迁移为渲染/交互测试；保留少量契约断言。 |

本审查不将上述存量问题误报为已修复。BUG-PS-01 至 BUG-PS-03 完成且 Windows 真机
验证前，不允许宣称萌宠的 macOS / Windows 透明表面已完全交付。
