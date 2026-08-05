# Orca 文件工作区体验审计

日期：2026-08-05

## 审计结论

Orca 的文件工作区可作为交互参考，但不能直接移植。其实现绑定 Electron 主进程、SSH 文件系统、浏览器编辑器与自身工作区生命周期；JunQi 是 Tauri 桌面客户端，并以本机工作区 IPC 与 OpenClaw Gateway 为边界。

本次仅采用下列已能由 JunQi 现有契约支撑的能力：

- 在本机 Worktree 内快速打开文件。
- 在搜索结果中分别呈现文件名和原生目录字段。
- 保持紧凑的标签、搜索层与键盘优先交互。

## 已核对实现

| 领域 | Orca 参考 | JunQi 已有契约 | 本次决定 |
| --- | --- | --- | --- |
| 快速打开 | 本地与远程文件搜索、结果取消与选择 | `search_project_files` 仅搜索本机 Worktree 的 Git 已跟踪文件 | 在 `FileExplorer` 增加本地快速打开，不扩大搜索范围 |
| 编辑器 | 多视图、远程内容与浏览器编辑器 | `FileViewer`、CodeMirror、统一只读预览 | 保留现有查看器，不引入替代编辑器 |
| 文件结果 | 文件名、目录与排序信息 | 原生命令已返回 `name`、`dir`、`extension` | 适配器保留条目元数据，调用方不自行猜测路径 |
| 远程运行时 | Electron 与 SSH 实现 | JunQi 运行时和 OpenClaw Gateway 为独立边界 | 不迁移，不模拟 |

## 运行证据

- `src-tauri/src/lib.rs` 注册 `commands::fs_neu::search_project_files`。
- `src-tauri/src/commands/fs_neu.rs` 将结果上限限制为 200，使用 Git 文件列表并返回路径、文件名、目录、扩展名。
- `src/workspace-files/adapters/localWorkspaceFiles.ts` 是前端调用该 command 的既有适配器。
- `src/pages/file-manager/WorkspaceFileManager.tsx` 与 `src/pages/AgentWorkspace/index.tsx` 均复用 `FileExplorer`，适合将入口放在共享组件中。

## 视觉审查

已读取 Orca 的快速打开与编辑器组件，以及 JunQi 现有文件树、标签、工具栏与 Aegis 令牌。当前本地应用浏览器连接不可用，未能取得运行时截图；不将未实测的视觉效果描述为已验收。后续真机验收需覆盖浅色与深色主题、不同窗口宽度及 Windows、CentOS、Ubuntu。

## 验证结果

- `pnpm lint` 通过，模块边界、版本一致性与 TypeScript 检查通过。
- 工作区快速打开键盘模型与本地搜索元数据映射的目标测试通过。
- `pnpm test` 通过。测试输出包含既有 SSR `useLayoutEffect` 警告，未由本次文件工作区变更引入，且没有测试失败。
- `pnpm build` 通过，包含协作插件契约验证、TypeScript 与 Vite 生产构建。
- `pnpm verify:openclaw-docs` 与 `git diff --check` 通过。
- 已扫描本次变更和新增文件，未发现 Emoji。

## 不采用项

- Orca 的 Electron 主进程和 SSH 文件系统。
- Orca 的浏览器或 Monaco 编辑器依赖。
- Orca 的 CSV、笔记本、Mermaid、差异视图等 JunQi 当前没有原生契约支撑的预览类型。
- 对 OpenClaw Gateway 文件、会话、工件或引导文件添加本地搜索的模拟实现。
