# 萌宠文字与聊天窗口恢复记录

日期：2026-07-29

## 证据

- `get_pet_backdrop_reading` 在 macOS 屏幕录制权限不可用时返回 `permission-denied`，不会主动请求权限。
- 旧 `resolvePetBackdropTextStyle` 对不可用采样返回 `null`；`PetBubble` 因此回退主题文字且不渲染底板。
- ChatView 自动加载 effect 以 `void loadHistory()` 启动前台请求；`loadHistory` 对前台失败会抛出异常，因此进入全局 `unhandledrejection`。
- 聊天已经维护 `historyErrorBySession` 和重试入口，初始化异常属于局部可恢复状态。

## 修改结果

- 桌面采样不可用或关闭时使用深色半透明安全底板和浅色文字。
- 采样可用时按附近亮度选择明暗底板；高纹理区域提高底板不透明度。
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
