# 文件预览收敛计划

日期：2026-07-29

## 任务

- [x] 盘点所有文件预览、Markdown 和 iframe 入口。
- [x] 区分真实文件、消息正文、记忆内容和生成式 artifact。
- [x] 统一托管文件的格式联合类型和加载入口。
- [x] 提取只读 `ManagedFilePreview` 并删除独立 Markdown 渲染器。
- [x] 收口文件管理器的预览状态与渲染分支。
- [x] 接通终端到共享 `FileViewer` 的文件预览路由。
- [x] 补充行为回归并完成全量自动化验证。
- [x] 拆分 `FileViewer` 的编排、文档生命周期、预览、状态栏、标签栏与能力职责。
- [x] 合并工作区 Adapter 到 typed `read_file_preview` IPC，并清理注销 command 的调用。
- [x] 为共享源码编辑器补充不依赖运行时主题注入时序的静态结构契约。
- [x] 增加 gutter 与正文横向布局源码回归。
- [ ] 完成 Tauri 桌面交互验收。

## 验证结果

- 前端全量 1829 项、脚本 223 项、Rust 648 项通过；Rust 3 项按环境契约忽略。
- `pnpm lint`、`pnpm build`、`cargo fmt -- --check`、`cargo check --lib` 与 `git diff --check` 通过。
- 构建最大 JavaScript chunk 为 513.31 kB，无循环 chunk 或超限警告。
- `1.4.17` ARM64 本地 DMG 已通过镜像、版本、架构和 ad-hoc 签名核验。
- 未运行桌面真机走查，源码 gutter 布局、PDF WebView、音视频播放和终端跳转保留为待验证。

## 影响文件

- `src/services/chat/filePreview.ts`
- `src/components/FileExplorer/ManagedFilePreview.tsx`
- `src/components/FileExplorer/MarkdownPreview.tsx`
- `src/components/Chat/ResultCards.tsx`
- `src/pages/FileManager.tsx`
- `src/pages/TerminalPage/index.tsx`
- `src/components/FileExplorer/filePreviewRoute.ts`
- `src/components/FileExplorer/FileViewer.tsx`
- `src/components/FileExplorer/FilePreviewPane.tsx`
- `src/components/FileExplorer/useWorkspaceFileDocument.ts`
- `src/components/FileExplorer/fileViewerCapabilities.ts`
- `src/workspace-files/adapters/localWorkspaceFiles.ts`

## 回滚边界

不改变文件内容、持久化数据或 Tauri command。回滚只涉及前端只读预览、格式分类和页面路由。
