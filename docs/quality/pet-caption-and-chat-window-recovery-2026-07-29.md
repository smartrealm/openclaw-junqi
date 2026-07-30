# 萌宠文字与聊天窗口恢复记录

日期：2026-07-29

## 证据

- `get_pet_backdrop_reading` 在 macOS 屏幕录制权限不可用时返回 `permission-denied`，不会主动请求权限。
- 旧 `resolvePetBackdropTextStyle` 对不可用采样返回 `null`；`PetBubble` 因此回退主题文字且不渲染底板。
- ChatView 自动加载 effect 以 `void loadHistory()` 启动前台请求；`loadHistory` 对前台失败会抛出异常，因此进入全局 `unhandledrejection`。
- 聊天已经维护 `historyErrorBySession` 和重试入口，初始化异常属于局部可恢复状态。

## 修改结果

- 桌面采样不可用或关闭时，按萌宠独立窗口实际生效的明暗主题选择安全前景色；浅色主题不再回退成白字。
- 采样可用时按萌宠当前位置附近的亮度选择深浅文字；包括高纹理区域在内均不使用文字阴影、滤镜、描边或发光，也不绘制卡片底板或边框。
- ChatView 首次历史加载在 effect 边界捕获 rejection，只记录诊断；现有聊天恢复提示继续拥有用户界面。
- 全局异常策略保持严格，真实未处理的编程错误仍显示致命遮罩。

## 验证

- 相关回归测试：31 项通过。
- `pnpm lint`：通过，包含 TypeScript 和模块边界检查。
- `pnpm test`：通过，223 项测试、31 个测试套件，无失败。
- `pnpm build`：通过，包含 collaboration bundle、TypeScript 和 Vite 生产构建。
- 默认 `pnpm tauri build --target aarch64-apple-darwin`：Rust release、`.app`、DMG 和 updater
  压缩包生成成功；命令最终因缺少 `TAURI_SIGNING_PRIVATE_KEY` 在 updater 签名阶段退出。
- 本地预览命令通过临时 CLI 配置关闭 updater 制品并指定 `--no-sign`，成功生成 `.app` 和 DMG，
  仓库发布配置没有被修改。
- `JunQi Desktop_1.4.17_aarch64.dmg`：`hdiutil verify` 通过，SHA-256 为
  `28e553788322f6c01f19ae3d34903e6f7a59da885434966d009a4ebcd7e21da0`。
- 应用版本为 `1.4.17`，二进制为 `arm64`。该本地预览包未完成正式签名或公证。
- Tauri 真机交互：未验证。当前环境没有可用的应用内浏览器运行时，未声称完成壁纸和 Gateway 断连场景的视觉验收。

## 2026-07-30 回归修正

- 复现证据：浅色主题与 `permission-denied` 组合在修复前仍返回 `#f8fafc` 白字和深色回退表面，定向测试按预期失败。
- 根因：背景样式解析器将不可用状态无条件映射为深色回退，没有接收萌宠独立 WebView 已解析的实际主题。
- 目标行为：原生采样可用时仍以桌面亮度为准；采样不可用或关闭时必须显式使用当前主题的安全文字色。提示文字保持无底板、无边框，避免独立窗口在壁纸上形成多余框体。
- 连续移动修正：旧 400ms 防抖会在拖动期间不断重置计时器，实际只在停止后采样。现在每个 `pet-moved` 都进入独立调度器，最多每 120ms 发起一次原生采样；在途请求期间只保留最新请求，完成后补采最新位置，且卸载后丢弃迟到结果。
- 自动化验证：实时采样相关定向测试 17 项、`pnpm lint`、`pnpm test`（1910 项前端测试与 224 项脚本测试）、`pnpm build` 均通过；`git diff --check` 通过。
- 本地 Apple Silicon 预览包：`JunQi Desktop_1.4.18_aarch64.dmg` 经 `hdiutil verify` 验证有效，应用版本为 `1.4.18`，二进制为 `arm64`，SHA-256 为 `1d9c8879dcd9b818059ad7c703ac21412b7b412f76ea22de26bda2477d7ce627`。
- 签名边界：应用使用 ad-hoc 签名且结构校验通过，没有 Team Identifier；该包不是正式开发者签名或公证制品。
- 未验证边界：需要在 macOS 浅色首次启动页、深色桌面及屏幕录制权限允许/拒绝两种状态下进行真机视觉验收。

## 2026-07-30 文字颜色适配补充修正

- 复现证据：原生采样返回 WCAG 相对亮度，但前端使用固定 `luminance > 0.45` 选择深色字；中亮度背景（例如相对亮度 `0.30`）会错误使用白字。修复前新增测试按预期失败。
- 对比度策略：现在分别计算 `#101318` 与 `#f8fafc` 对当前背景亮度的 WCAG 对比度，选择对比度更高的文字，不把相对亮度当作普通灰度。
- 连续移动策略：每次有效位置采样都直接比较 `#101318` 与 `#f8fafc` 在当前背景亮度上的 WCAG 对比度，并立即选择对比度更高的前景；不再保留上一次 surface，避免拖动到中灰区域后沿用与背景接近的旧颜色。
- 高纹理策略：Rust 返回的亮度标准差 `contrast` 不再触发任何视觉特效；复杂背景同样只依靠纯色前景切换，不绘制文字阴影、滤镜、描边、背景、边框、box-shadow 或 outline。
- 视觉复核修正：首次候选包暴露出普通状态 `2–5px`、高纹理状态 `2–11px` 的模糊阴影会在小字号上形成明显发光；随后零模糊贴边阴影仍不满足产品要求。现已统一为 `text-shadow: none` 和 `filter: none`，并覆盖动态适配及深色主题降级路径；该修正后的候选包仍需重新打包和真机复核。
- 降级边界：屏幕采样关闭、权限拒绝、平台不支持或采样失败时，继续使用萌宠独立 WebView 当前实际主题的安全深浅文字，不沿用失效桌面读数。
- 自动化证据：萌宠定向测试 37 项通过；`pnpm lint` 通过并检查 647 个文件的模块边界；`pnpm test` 通过，其中前端 1954 项、脚本 224 项；`pnpm build` 通过并转换 8992 个 Vite 模块；`git diff --check` 通过。
- 生成物边界：Provider catalog 与 collaboration bundle 在生产构建中重新生成并校验，未产生额外 Git 差异。
- Rust 边界：本轮没有修改 `PetBackdropReading`、Tauri command 或原生采样；未重复运行 Rust 测试，现有 `luminance`/`contrast` camelCase IPC 契约保持不变。
- 未验证边界：浅色、深色、中灰、高纹理壁纸以及移动跨越明暗区域仍需真实 Tauri 窗口视觉验收。

## 2026-07-30 ChatView 后台拒绝补充修正

- 复现证据：已安装的 `1.4.18` 应用仍包含 `ChatView-Bg7P7LM0.js`。当前工作树生产构建的
  ChatView 资源哈希不同，因此运行窗口不是本轮扩展后的前端产物。
- 精确定位：按提交 `35bd5c4` 重建得到同名资源，`8:7064` 对应 `loadHistory` 前台失败后的
  rethrow。上游 Gateway 流结束、运行态对账和 transcript 事件直接丢弃该 Promise，是主要泄漏点。
- 根因：此前只消费了首次历史加载的拒绝；App Gateway 回调、缓存后的权威刷新和两类定时重试
  仍使用未观察的 Promise。它们与前台请求去重时可以继承前台失败，并进入全局拒绝遮罩。
- 修复：新增统一 `startRecoverableTask`，同时处理同步抛错和异步拒绝。首次历史加载、缓存刷新、
  启动重试、超时重试和手动重连统一进入局部错误提示与 Gateway 连接状态，不再泄漏到全局遮罩。
- 边界：全局错误策略没有放宽；不属于明确可恢复后台操作的编程错误仍进入致命错误层。
- 自动化验证：根因定向测试 20 项、完整前端测试 1945 项、`pnpm lint` 和 `pnpm build`
  均通过；模块边界检查覆盖 639 个文件，生产构建转换 8985 个模块。
- 桌面边界：当前 `/Applications/JunQi Desktop.app` 仍是包含旧资源的已安装包。本轮没有覆盖安装包，
  也没有把生产前端构建描述为真实 Tauri 窗口验收。
