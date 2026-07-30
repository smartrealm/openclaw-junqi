# 主窗口关闭 ACL 修复计划

日期：2026-07-30

## 实施

- [x] 追踪红色关闭按钮到工作台关闭检查点和 `window.destroy()`。
- [x] 核对当前 Tauri schema 中 `close` 与 `destroy` 的独立权限。
- [x] 增加最小权限范围回归测试。
- [x] 新增仅匹配 `main` 窗口的销毁权限 capability。
- [x] 运行 capability schema、lint、完整测试、生产构建和差异检查。
- [ ] 使用修复后的 macOS 桌面包验证红色关闭按钮。

## 文件范围

- `src-tauri/capabilities/main-window-lifecycle.json`
- `src/workbench/session/useWorkbenchSessionPersistence.test.ts`
- `docs/quality/`、`specs/quality/`、`plans/quality/`
