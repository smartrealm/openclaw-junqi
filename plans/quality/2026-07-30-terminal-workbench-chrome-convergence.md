# 终端与工作台 Chrome 一致性实施计划

日期：2026-07-30

## 实施

- [x] 核对独立终端与 AI 工作台的 ownership 边界和现有布局。
- [x] 抽取共享侧栏标题与图标按钮组件。
- [x] 替换终端和 AI 工作台的重复侧栏 chrome。
- [x] 统一顶部栏侧栏、Agent 和通知按钮规格。
- [x] 删除终端路由的应用级固定主题覆盖和废弃样式。
- [x] 增加一致性回归测试。
- [x] 完成自动化验证。
- [ ] 完成 macOS 与 Windows 真机视觉验收。

## 文件范围

- `src/components/Layout/WorkspaceChrome.tsx`
- `src/components/Layout/TopBar.tsx`
- `src/components/Layout/AppLayout.tsx`
- `src/pages/TerminalPage/index.tsx`
- `src/pages/AgentWorkspace/index.tsx`
- `src/pages/AgentWorkspace/workbench.css`
- `src/styles/terminal-kooky.css`
- 对应测试与三层文档
