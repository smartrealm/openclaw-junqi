# AI 工作台 Orca 对照改造计划

日期：2026-07-28

## 任务

- [x] 核对 JunQi AI 工作台、Git 组件和现有测试。
- [x] 对照 Orca 右侧活动栏、Source Control 与可见窗口刷新实现。
- [x] 确定迁移边界和非目标。
- [x] 提取可测试的路径筛选模型。
- [x] 提取可复用的可见窗口 interval hook。
- [x] 删除伪任务范围、无效控件、私有英文词典和遗留注释。
- [x] 接入真实路径筛选和串行自动刷新。
- [x] 补齐三套当前启用的 locale，并覆盖 Git 变更、历史和 diff。
- [x] 防止历史、分支和提交详情的旧请求覆盖当前选择。
- [x] 修复命令面板 `forwardRef` 图标对象渲染崩溃并补回归测试。
- [x] 删除智能体展开工作区的重复文件预览管线并接入共享 `FileViewer`。
- [x] 提取工作区页签 reducer，覆盖关闭、删除和目录重命名。
- [x] 运行定向和全量验证。

## 未验证边界

- 未继续操作用户现有窗口，因此没有真机走查 Git 变更自动刷新、筛选与 stage/discard 收敛；该边界已记录，不作为自动化通过的替代结论。

## 影响文件

- `src/components/Git/GitChanges.tsx`
- `src/components/Git/GitFileBrowser.tsx`
- `src/components/Git/GitHistory.tsx`
- `src/components/Git/GitDiffViewer.tsx`
- `src/components/Git/DiffFileBlock.tsx`
- `src/components/Git/gitChangesModel.ts`
- `src/components/Git/useCancellableInvoke.ts`
- `src/hooks/useVisibleInterval.ts`
- `src/utils/coalescedAsyncRunner.ts`
- `src/pages/AgentWorkspace/index.tsx`
- `src/pages/GitPage.tsx`
- `src/locales/*.json`
- `src/components/CommandPalette.tsx`
- `src/components/CommandPalette.test.tsx`
- `src/components/Workspace/WorkspacePanel.tsx`
- `src/components/FileExplorer/fileViewerTabsState.ts`

## 回滚边界

本轮不迁移持久化数据，不改变 Git command 参数和返回值。回滚只涉及前端展示、刷新生命周期和 locale。
