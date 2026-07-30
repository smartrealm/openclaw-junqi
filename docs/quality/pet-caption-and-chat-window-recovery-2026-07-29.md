# 萌宠文字与聊天窗口恢复记录

日期：2026-07-29

## 证据

- `get_pet_backdrop_reading` 在 macOS 屏幕录制权限不可用时返回 `permission-denied`，不会主动请求权限。
- 旧 `resolvePetBackdropTextStyle` 对不可用采样返回 `null`；`PetBubble` 因此回退主题文字且不渲染底板。
- ChatView 自动加载 effect 以 `void loadHistory()` 启动前台请求；`loadHistory` 对前台失败会抛出异常，因此进入全局 `unhandledrejection`。
- 聊天已经维护 `historyErrorBySession` 和重试入口，初始化异常属于局部可恢复状态。

## 修改结果

- 桌面采样不可用或关闭时，按萌宠独立窗口实际生效的明暗主题选择安全前景色；浅色主题不再回退成白字。
- 采样可用时按萌宠当前位置附近的亮度选择深浅文字；高纹理区域使用受控文字阴影维持字形边界，不再绘制卡片底板或边框。
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
