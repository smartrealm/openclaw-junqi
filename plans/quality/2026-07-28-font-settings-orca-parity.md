# 字体设置对齐计划

日期：2026-07-28

## 任务

- [x] 对照 JunQi 与 Orca 的字体设置、持久化和应用范围。
- [x] 增加字体值规范化、字体栈构建、目录回退和回归测试。
- [x] 重做共享字体选择器的惰性加载、输入、搜索、键盘操作和虚拟列表。
- [x] 增加编辑器字体状态并接入启动恢复。
- [x] 在活动外观设置页接入界面、等宽和编辑器字体，并移除终端页的重复字体入口。
- [x] 修正 CodeMirror、文件预览、Git diff 和普通 UI 的字体变量。
- [x] 清理不再使用的字体列表常量与样式。
- [x] 执行定向测试、lint、全量测试、Rust 检查、生产构建和本地打包。

## 验证结果

- 字体与终端定向回归 11 项通过。
- `pnpm lint` 通过，575 个模块边界检查无错误。
- `pnpm test` 通过：前端 1,688 项、脚本 217 项，共 1,905 项。
- `cargo fmt -- --check`、`cargo check --lib`、`pnpm build` 和 `git diff --check` 通过。
- Apple Silicon `.app` 与 DMG 重新生成；源码应用、DMG 和挂载后的应用通过严格 codesign，`hdiutil verify` 通过。
- DMG 内应用版本为 `1.4.14`、架构为 `arm64`，使用 ad-hoc 签名。未做 Developer ID 签名、公证或实际桌面交互验收。

## 影响范围

- `src/components/settings/`
- `src/stores/settingsStore.ts`
- `src/theme/`
- `src/utils/fonts.ts`
- `src/utils/codeMirrorTheme.ts`
- `src/components/FileExplorer/`
- `src/components/Git/`
- `src/styles/`
- `src/locales/`

## 未验证边界

- 系统字体目录内容和字体渲染质量依赖实际操作系统。
- xterm 字符宽度重算与重启恢复需要真实 Tauri 窗口验收。
