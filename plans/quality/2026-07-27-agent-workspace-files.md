# 智能体工作区文件能力修复计划

日期：2026-07-27

## 任务

- [x] 审查智能体工作区、共享文件树、文件查看器和 Rust 文件命令。
- [x] 查阅 React Portal、Tauri command、Tauri dialog 官方文档。
- [x] 抽出打开标签路径变更纯函数并增加回归测试。
- [x] 将文件树和标签菜单 Portal 到 `document.body`，修复 viewport 定位和菜单颜色。
- [x] 增加文件树可见的新建入口、打开与重命名菜单、内联重命名和错误反馈。
- [x] 增加 `rename_path` Rust command、注册和路径安全测试。
- [x] 在智能体工作区与文件管理页同步重命名/删除后的标签。
- [x] 明确 Markdown 预览、文本编辑和立即保存交互。
- [x] 执行前端测试、Rust 测试、lint 和生产构建。
- [x] 修复 BUG-AW-FILE-04：文件管理页传递当前主题，纠正 CodeMirror RGB 颜色并补齐 Markdown 预览样式。
- [x] 把 CodeMirror 基础主题提取为共享扩展，并接入智能体详情 `WorkspacePanel` 的独立编辑器。
- [x] 增加主题与预览源码回归并重新执行前端验证和生产构建。
- [x] 对照 Orca 外部文件变更语义和 JunQi 本地 watcher 契约，定义干净重载与脏草稿冲突分支。
- [x] 为活动预览注册父目录 watcher、焦点检查和 watcher 不可用时的可见窗口轮询。
- [x] 增加冲突横幅、自动保存门禁、“从磁盘重新加载”和“保留我的修改”。
- [x] 增加磁盘同步纯状态回归与 FileViewer 集成源码回归。
- [x] 用纯文本文档状态机替换分散的正文、基线和冲突 ref，并删除失效的源码字符串断言。
- [x] 增加 `write_file_content_if_unchanged` 乐观并发门禁、写后回读和 Rust 行为回归。
- [x] 串行化同一标签的自动保存，并在写入期间继续编辑时排队保存最新草稿。
- [x] 抽离 watcher 生命周期、文件文档 hook 和冲突/不可用提示组件，清理 `FileViewer` 中重复职责。
- [x] 外部删除或读取失败时暂停保存，文件恢复后重新建立基线或进入冲突状态。
- [x] 重新执行全量前端测试、lint 和生产构建。
- [x] 对照 Orca 行项目/空白区菜单 ownership，盘点 JunQi 全部文件树入口。
- [x] 提取共享右键命令矩阵、Portal 菜单、名称输入和路径操作控制器。
- [x] 将智能体详情与终端文件树接入共享操作，删除终端私有文件菜单分支。
- [x] 在智能体详情中串行保存相关脏文件，并同步重命名/删除后的预览路径。
- [x] 增加跨页面菜单矩阵和接入回归，验证四份 locale JSON。
- [x] 对照 Orca 文件读取、语言识别和专用预览器，记录真实支持矩阵。
- [x] 以 `read_file_preview` 替换前端扩展名猜测和旧文本/图片双命令。
- [x] 让 `FileViewer` 与 `WorkspacePanel` 共用图片、PDF、未知二进制只读渲染器。
- [x] 删除旧图片类型、扩展集合与命令注册，补 IPC 解码和 Rust 分类回归。
- [x] 对照 Orca 的编辑器标题栏、视图切换、Markdown 操作菜单、目录与标签菜单，确定 JunQi 的共享交互结构。
- [x] 抽离统一 Markdown GFM 预览、目录、文件查看器操作栏和路径模型，删除文件管理页的重复渲染器。
- [x] 增加稳定标题锚点、当前预览内跳转、本地图片根目录门禁、长行换行和完整标签右键操作。
- [x] 补充 Markdown 渲染、标题提取、跨平台路径与源码接入回归。
- [ ] 在实际 Tauri 桌面窗口走查文本自动刷新、冲突恢复操作和图片热刷新。
- [ ] 在实际 Tauri 桌面窗口逐页走查文件/目录/空白处右键操作。
- [ ] 在实际 Tauri 桌面窗口走查 Markdown 目录、模式切换、更多菜单、标签右键和本地图片。

## 验证结果

- `pnpm test`：1,879 项通过（前端 1,662、脚本 217）。
- `pnpm lint`：通过，566 个模块边界检查无错误。
- `pnpm build`：通过；仅保留既有的循环 chunk 与 bundle size 提示。
- `cargo fmt -- --check`、`cargo check --lib`：通过。
- `cargo test --lib`：626 通过，3 个环境依赖测试忽略。
- 文件能力定向回归：14 通过。
- 重命名安全定向回归：2 通过。
- `git diff --check`：通过。
- 跨页面右键定向回归：15 项通过；`pnpm test` 共 1,894 项通过（前端 1,677、脚本 217）；`pnpm lint` 与 573 个模块边界检查、`pnpm build`、`git diff --check` 通过。
- Apple Silicon 本地 `.app` 与 DMG 使用 ad-hoc identity；严格 codesign 与 `hdiutil verify` 通过。Tauri 内置 Finder 美化脚本退出后由已生成临时映像完成 DMG；未做 Developer ID 签名、公证、Gatekeeper 接受或桌面交互验收。
- 文件格式分流定向回归 13 项通过；`pnpm test`、`pnpm lint`（575 个模块边界检查）、`pnpm build`、`cargo fmt -- --check`、`cargo check --lib` 和 `git diff --check` 通过；`cargo test --lib` 为 627 项通过、3 项忽略。
- 重新生成的 Apple Silicon `.app` 与 DMG 严格 codesign 和 `hdiutil verify` 通过；DMG 内应用为 `1.4.14`、`arm64`、ad-hoc 签名。未做 Developer ID 签名、公证或桌面交互验收。
- Markdown、跨平台路径、工作区源码接入和文件管理页接入定向回归 14 项通过；`pnpm test` 共 1,932 项通过（前端 1,709、脚本 223）；`pnpm lint` 与 582 个模块边界检查、`pnpm build`、locale JSON 解析和 `git diff --check` 通过。
- 生产构建最大 JavaScript chunk 为 513.31 kB，低于 550 kB 门禁，没有循环 chunk 或超限提示。当前会话没有可用应用内浏览器实例，Markdown 目录、模式切换、更多菜单、标签右键和本地图片未完成实际 Tauri 窗口验收。

## 影响文件

- `src/components/FileExplorer/*`
- `src/pages/AgentWorkspace/index.tsx`
- `src/pages/FileManager.tsx`
- `src-tauri/src/commands/fs_neu.rs`
- `src-tauri/src/lib.rs`
- `src/locales/*.json`（仅需要新增的文件操作文案）

## 回滚边界

改动不迁移持久化数据，不改变工作区根目录来源。前端回滚可移除新增菜单和标签映射；Rust 回滚只需注销并删除 `rename_path`，不会留下格式变更。
