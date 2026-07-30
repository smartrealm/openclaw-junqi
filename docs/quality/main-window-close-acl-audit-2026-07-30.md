# 主窗口关闭 ACL 审计

日期：2026-07-30

## 依据与根因

主窗口关闭处理器会阻止原始关闭事件，依次保存本地编辑器、持久化工作台会话、
停止工作台 PTY，最后调用 Tauri `window.destroy()` 完成关闭。现有
`main-capability` 允许 `close`，但没有允许 `destroy`，因此 macOS 红色关闭按钮会触发
`plugin:window|destroy not allowed by ACL`。

项目安装版本生成的 Tauri capability schema 明确定义了
`core:window:allow-destroy`。`close` 和 `destroy` 是两个独立权限，不能互相替代。

## 修复

- 新增只匹配 `main` 窗口的 `main-window-lifecycle` capability。
- 仅授予 `core:window:allow-destroy`，不扩大宠物、快捷会话、动态岛和控制台窗口权限。
- 保留原有持久化、PTY 清理和失败后重试语义。

## 验证

- 回归测试确认权限仅作用于 `main` 窗口，且只有 `allow-destroy`。
- `pnpm lint`：通过。
- `pnpm test`：通过。
- `APPLE_SIGNING_IDENTITY=- pnpm tauri build --target aarch64-apple-darwin --bundles dmg`：通过。
- `git diff --check`：通过。
- 新 DMG 经 `hdiutil verify` 校验有效；挂载后的应用通过
  `codesign --verify --deep --strict`。
- 制品版本为 `1.4.18`，架构为 `arm64`，使用 ad-hoc 签名，未公证。
- macOS 红色关闭按钮仍需在重新打包的真实桌面应用中手工验证。
