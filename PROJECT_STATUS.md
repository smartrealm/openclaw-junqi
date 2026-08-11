# 项目交接状态

更新时间：2026-08-11

## 当前目标

在不改变 OpenClaw、Tauri 与 DWS 权威语义的前提下，收敛 JunQi Desktop 的交互、动效、信息层级与跨页面视觉一致性，并完成真实桌面验收。

## 已完成内容

- 已合并 `main` 的安装向导更新：模型供应商和渠道长选项列表支持搜索、键盘操作与原始值保持，只提交官方 Wizard 返回的选项值。
- 环境检测与环境复核共享稳定的窗口自适应内容区；日志仅在卡片内部滚动，运行型步骤不再位移或淡入。
- 已删除没有 OpenClaw 官方协议依据的本地 AgentRun、AI 工作台与任务简报全链路，并同步删除无消费者翻译、图标和过期质量计划。

## 关键技术决策

- JunQi 只投影 OpenClaw 已定义的会话、任务账本、审计、工具、向导与运行时状态；不保留本地替代语义。
- 向导长列表只投影官方返回的值；搜索、选择和键盘交互不改变值、顺序或提交协议。
- 运行时页面使用可用视口与内部滚动边界，避免日志、滚动条和步骤切换触发外层布局跳动。

## 修改过的核心文件

- `src/pages/SetupPage/WizardScreen.tsx`
- `src/pages/SetupPage/wizard/WizardOptionSearch.tsx`
- `src/hooks/useSetupFlow/useWizardSession.ts`
- `src/components/setup/SetupFlowPanels.tsx`
- `src/motion/setupStepTransition.tsx`
- `src/AppRouteTree.tsx`
- `src-tauri/src/lib.rs`
- `specs/openclaw-agent-run-alignment.md`

## 测试与验证结果

- 合并后安装向导、取消、环境检测、步骤动效和选项搜索定向回归共 82 项通过。
- 合并后 `pnpm lint` 与 `git diff --check` 通过；模块边界检查覆盖 895 个文件，版本一致性检查通过。
- 合并后完整 `pnpm test`、`pnpm build`、`cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib` 与 `pnpm verify:openclaw-docs` 均通过；前端测试 2648 项通过，Rust 库测试 632 项通过、1 项忽略。

## 已知问题

- 真实 Tauri 环境检测视觉验收仍受 macOS 锁屏阻断，不能用浏览器或锁屏截图替代。
- 尚未在真实 OpenClaw 安装向导核验模型供应商完整列表、渠道多选长列表、亮暗主题和窄窗口。
- 尚未在 macOS、Windows、Linux 实际安装包完成窗口缩放、键盘焦点与长时间性能验收。

## 已尝试但未完成的方案

- Tauri 开发进程可启动，但系统锁屏后无法采集应用画面；未尝试绕过系统解锁。

## 下一步开发顺序

1. 将当前未提交改动退回工作区并复查 `main` 向导变更与现有安装流程的重叠。
2. 执行合并后的定向测试、静态检查、构建与 Rust 测试。
3. 在可用的真实桌面与 OpenClaw 向导环境完成安装、环境检测和跨平台视觉验收。
