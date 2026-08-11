# 项目交接状态

更新时间：2026-08-11

## 当前目标

以 `main` 为基准整合本地长期分支的已提交改动，并在不触碰其他工作树未提交内容的前提下统一分支基线。

## 已完成内容

- `Blues-Code/Jarvis` 的已提交 AI 原生交互、聊天界面、布局和主题改动已快进合入 `main`。
- `Blues-Code/code`、`Blues-Code/dingtalk` 和 `daxia` 经共同祖先核对后没有独有提交，无需重复合并。
- Jarvis 工作树中的未提交改动已明确排除在本次整合之外，没有被覆盖、暂存或带入 `main`。
- 合并后的前端完整测试、静态检查和生产构建均已通过。

## 关键技术决策

- 分支整合只处理 Git 已提交历史；其他工作树的未提交内容属于原工作树所有者，不以分支拉齐为由覆盖或隐式提交。
- 只有存在独有提交的分支进入 `main`；没有独有提交的分支通过快进统一基线，避免产生无意义合并提交。
- OpenClaw 交互继续以官方协议和派生投影为边界，合并不放宽既有协议、权限和运行时约束。

## 核心文件

- `src/components/Chat/ChatSidePanel.tsx`
- `src/components/Chat/MessageBubble.tsx`
- `src/components/Chat/ToolCallBubble.tsx`
- `src/components/Layout/AppLayout.tsx`
- `src/components/Layout/NavSidebar.tsx`
- `src/components/setup/SetupFlowPanels.tsx`
- `src/styles/index.css`
- `docs/design/ai-native-interaction-reference.md`

## 测试与验证

- `pnpm lint`：通过，模块边界、版本一致性和 TypeScript 检查均通过。
- `pnpm test`：通过，包含聊天交互可访问性、OpenClaw 协议、安装向导和脚本测试。
- `pnpm build`：通过，协作插件、钉钉业务插件、TypeScript 和 Vite 生产构建完成。
- `git diff --check`：提交前执行。

## 已知问题

- Jarvis 工作树仍有原有未提交改动，本次没有审查或合并这些内容。
- 合并后的聊天布局尚未在 macOS、Windows 和 Linux 桌面真机逐项完成亮色、暗色、窄窗口和键盘焦点视觉验收。
- 测试输出仍包含既有 Radix Tooltip 服务端渲染 `useLayoutEffect` 警告，但测试未失败；该警告不在本次分支整合范围内。

## 下一步顺序

1. 在 Jarvis 工作树所有者完成并提交其当前改动后，再按共同祖先审查新增提交。
2. 对合并后的聊天交互执行桌面真机视觉与键盘操作验收。
3. 需要推送或发布时，先核对所有分支指针、版本文件和发布工作流，再单独执行远端操作。
