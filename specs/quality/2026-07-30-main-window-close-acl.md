# 主窗口关闭 ACL 修复规格

日期：2026-07-30

## 当前行为

主窗口完成关闭前检查点后调用 `window.destroy()`，但 capability 未授权该命令，
导致 Promise rejection，窗口无法按预期关闭。

## 目标行为

- 主窗口完成编辑器检查点、工作台会话检查点和 PTY 清理后可以销毁。
- 销毁权限不得授予不需要该能力的其他窗口。
- 检查点或 PTY 清理失败时仍保持窗口并允许再次关闭重试。

## 验收条件

- Tauri capability 为 `main` 窗口授予 `core:window:allow-destroy`。
- 其他窗口不会因本次修改获得销毁权限。
- 现有关闭顺序回归测试继续通过。
- capability schema、lint、测试、构建和差异检查通过。

## 未验证边界

- 修复后的 macOS arm64 DMG 已完成镜像、签名、版本和架构校验。
- macOS 真机红色关闭按钮交互仍需使用修复后的桌面包手工验证。
