# 安装向导存储页导航可见性验证

日期：2026-08-02

## 问题

在内容高度超过安装窗口可视区域时，`SetupShell` 使用 `my-auto` 垂直居中整个步骤内容。滚动容器会把内容块向可视区域上下两侧分配空间，导致位于独立底部 footer 的“上一步”和“下一步”操作在用户进入存储位置步骤后看似消失。

## 目标行为

- 步骤内容从滚动区域顶部开始布局，不使用会产生负向溢出的垂直自动外边距。
- 底部导航 footer 保持 `shrink-0`，始终位于内容滚动区域之外。
- 内容过高时只滚动 main，返回和继续操作仍可达。
- 不改变 `flow.goBack`、存储草稿和运行时回滚契约。

## 实现

`src/components/setup/SetupFlowPanels.tsx` 删除步骤 section 的 `my-auto`。新增 `src/components/setup/SetupShellLayout.test.tsx`，通过渲染共享 Shell 验证 main 可滚动、section 不再垂直自动居中、footer 保持不可收缩且导航操作存在。

## 验证边界

- 自动化验证共享布局 DOM 契约。
- 尚未在真实 Tauri 窗口中对截图对应尺寸进行视觉复测。
- `docs/previews/junqi-first-run-flow.html` 是流程语义图，本次没有改变步骤或状态转换，因此无需修改；线上预览未验证。
