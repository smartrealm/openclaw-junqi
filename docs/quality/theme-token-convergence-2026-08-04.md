# 主题 Token 收敛验证

日期：2026-08-04

## 依据

本记录承接 `docs/quality/full-codebase-audit-2026-07-29.md` 的 FCA-08。原审计已经要求产品 chrome 使用 Aegis 语义 token；本次继续处理仍会在深色主题中泄漏固定颜色或固定阴影的高频界面。

## 当前行为

主题切换已经可以更新大部分 Aegis CSS 变量，但仍有以下风险：

- 工作台 CSS 使用暗色 fallback，缺失 token 时会悄悄恢复为固定深色；
- xterm 主题对象在模块初始化时生成，切换主题后部分终端实例仍保留旧背景；
- 终端搜索、终端状态栏、工作区弹窗、动态岛和 Git diff 使用固定边框、阴影或状态色；
- 萌宠文字对比度已经动态计算，但部分文字和错误强调色仍直接写入组件。

## 目标行为

- 所有产品 chrome 的表面、边框、文字、状态色、阴影和遮罩都从当前 `data-theme` 的 Aegis token 读取；
- xterm 在创建和主题切换时都从当前 CSS 计算终端调色板，不重新创建 PTY，不丢失滚动内容；
- 搜索高亮使用当前主题的 attention 色，并在运行时重新计算为 xterm 可消费的实际颜色；
- 仅保留明确的内容色例外：主题预览、文件语言识别色、数据可视化、ANSI 无 DOM 时的回退值和萌宠 SVG 本体绘制色。

## 已实现

### 共享 token

四个具体主题均提供：

- `--aegis-shadow-card`、`--aegis-shadow-float`、`--aegis-shadow-popover`；
- `--aegis-scrim`；
- `--aegis-pet-text-on-light`、`--aegis-pet-text-on-dark`；
- `--aegis-status-*` 生命周期状态色。

Tailwind 的 `--shadow-card`、`--shadow-float` 和 `--shadow-popover` 已桥接到上述 token。业务组件逐项改用 `aegis-*` 语义色，不在 `[data-theme]` 全局重绑定 Tailwind 内置调色板，避免误改数据可视化、内容资产或未审查页面。

遮罩色从每个主题的 `--aegis-shadow-color` 派生，不复用深色主题中用于浅色悬浮反馈的 `--aegis-overlay`，避免深色弹窗遮罩反向提亮背景。

### 组件迁移

- `AgentWorkspace/workbench.css` 删除暗色 fallback，统一使用主题 token；
- `WorkbenchTerminalPane` 与 `AgentRunView` 使用共享终端主题构建器，并在主题变化后原地刷新 xterm；
- `terminalShared.ts` 删除按主题名写死的终端背景快照，`themeFor` 读取当前文档主题；
- 终端搜索、终端树、终端状态栏、终端编辑栏、代理概览、终端页面弹窗和命令面板改用共享边框、状态和阴影；
- Git diff、Git 历史、文件预览弹层和动态岛改用共享 diff、阴影和遮罩 token；
- 萌宠文字、背景采样和错误强调色改用主题变量，萌宠本体 SVG 调色板继续作为内容资产保留。

## 自动化验证

- `src/theme/runtimeCoverage.test.ts` 检查四个具体主题的共享 chrome、状态和萌宠可读性 token；
- `src/theme/tailwindThemeBridge.test.ts` 检查 Tailwind 语义变量和阴影映射，并确保实现不依赖旧调色板兼容桥；
- `src/theme/productChromeColors.test.ts` 继续按逐文件审查预算阻止新增未分类 hex；
- 萌宠对比度测试覆盖明暗、纹理背景和无原生采样回退。

## 未验证边界

本记录不宣称完成四主题真机视觉验收。仍需在 macOS、Windows 和 Linux 的桌面窗口中切换浅色、深色、暗黑和护眼主题，检查 xterm canvas、动态岛、弹窗阴影和系统主题跟随是否与原生窗口同步。ANSI 回退值仅在 CSS 变量不可读时使用，不代表产品主题的第二套配置。
