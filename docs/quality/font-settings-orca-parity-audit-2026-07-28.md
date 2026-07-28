# 字体设置与 Orca 对齐审计

日期：2026-07-28

## 已查阅实现

- JunQi：`SettingsPage`、`TerminalSettingsPanel`、`FontPanel`、`FontSelector`、`settingsStore`、主题启动流程、CodeMirror 与终端字体接入。
- Orca：`AppearanceInterfaceSection`、`TerminalAppearanceSection`、`EditorFontFamilySetting`、`FontAutocomplete`、`app-font-family`、`system-fonts` 与 settings IPC。

## 当前问题

1. JunQi 的活动设置页没有挂载已有 `FontPanel`，界面字体只能通过未使用的旧设置弹窗修改。
2. `setUiFont` 只写入 `--font-ui`，主体界面实际使用 `--font-sans`，因此多数界面不会响应选择。
3. 字体选择器加载失败后永久显示“加载中”；默认项标签为空；字体列表只截取前十几项，没有真正的虚拟滚动，大部分系统字体不可达。
4. 终端页维护固定六项下拉，与系统字体选择器重复且不能搜索或输入自定义字体。
5. JunQi 只有一个等宽字体值，同时承担终端、文件编辑器和 diff；用户无法像 Orca 一样单独选择编辑器字体。
6. 文件编辑器和 Markdown 样式把颜色变量 `--aegis-body` 当作字体使用，声明无效后依赖浏览器回退。

## Orca 可复用语义

- 界面字体、终端字体、编辑器字体分别持久化。
- 编辑器字体为空时跟随终端字体。
- 系统字体只在用户操作选择器时惰性加载，并缓存结果。
- 字体控件既接受已安装字体建议，也允许直接输入字体 family；清空代表恢复默认或继承。
- 系统字体枚举失败时使用平台回退列表，不让设置控件停在无结果状态。

## JunQi 目标

- 保留 Tauri `get_system_fonts` 与 `font-kit`，不移植 Orca 的 Electron IPC 或系统命令实现。
- 在实际 `/settings` 页面提供界面字体和编辑器字体；终端页使用同一个字体选择器设置终端字体。
- 统一字体栈规范化、默认/继承语义、搜索、键盘操作和虚拟滚动。
- `--font-ui` 与 `--font-sans` 同步；`--font-editor` 默认继承 `--font-mono`。
- 文件编辑器、文件预览代码和 Git diff 使用编辑器字体；终端继续使用终端字体；普通应用界面使用界面字体。

## 非目标

- 不移植 Orca 的 Electron settings store、Ghostty 字体导入、连字开关或终端主题系统。
- 不安装或下载字体。
- 不删除当前工作区中与本任务无关的旧设置代码。

## 验证结论

2026-07-28 已完成三类字体设置、共享选择器、启动恢复和应用范围修正。字体与终端定向回归 11 项通过；`pnpm lint` 与 575 个模块边界检查通过；`pnpm test` 为前端 1,688 项、脚本 217 项通过；`cargo fmt -- --check`、`cargo check --lib`、`pnpm build` 和 `git diff --check` 通过。生产构建仍只报告既有循环 chunk 与大 chunk 提示。

重新生成的 Apple Silicon `.app` 与 DMG 均通过严格 codesign，`hdiutil verify` 通过；挂载后确认应用版本 `1.4.14`、架构 `arm64`、签名类型为 ad-hoc。未启动实际 Tauri 窗口，因此系统字体目录、选择器定位、重启恢复和 xterm 字符宽度重排仍标记为待桌面交互验收；该制品未做 Developer ID 签名或 notarization。
