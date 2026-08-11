# 项目交接状态

更新时间：2026-08-12

## 当前目标

在不改变 OpenClaw、Tauri 与 DWS 权威语义的前提下，收敛 JunQi Desktop 的交互、动效、信息层级与跨页面视觉一致性，并完成真实桌面验收。

## 已完成内容

- 已合并 `main` 的安装向导更新：模型供应商和渠道长选项列表支持搜索、键盘操作与原始值保持，只提交官方 Wizard 返回的选项值。
- 环境检测与环境复核共享稳定的窗口自适应内容区；日志仅在卡片内部滚动，运行型步骤不再位移或淡入。
- 已删除没有 OpenClaw 官方协议依据的本地 AgentRun、AI 工作台与任务简报全链路，并同步删除无消费者翻译、图标和过期质量计划。
- 会话、工具轨迹、原生审批与任务账本完成一轮细腻交互收敛：工具状态、详情展开、进行中可访问语义、
  减少动态效果与窄窗口输入区均复用现有 Aegis token 和真实 Gateway 投影。
- 快捷回复与 Gateway 内联按钮不再把本地点击显示为成功完成；只保留本地选择态，避免伪造 Gateway
  处理结论。
- 已收敛 OpenClaw `update_plan` 的会话内 Plan：运行中计划保持 Composer 上方，终态计划保留在
  transcript；卡片使用真实步骤状态、纵向轨迹、修订入口与按需展开，不新增本地计划或完成状态。
- 已对最新版 OpenClaw 官方队列与本地发送链路完成核对：普通 Composer 发送保持 `chat.send` 原样
  交由 Gateway 的会话 lane 与有效 `queueMode` 决定；JunQi 不在客户端合并、丢弃或重排上游消息。
- 已将会话删除、重置等破坏性变更期间的本地消息交接窗口改为“等待会话变更”：它只表示尚未提交给
  OpenClaw 的消息，可编辑或放弃；Gateway 已确认接收的消息继续使用独立 `queued` 状态。

## 关键技术决策

- JunQi 只投影 OpenClaw 已定义的会话、任务账本、审计、工具、向导与运行时状态；不保留本地替代语义。
- 向导长列表只投影官方返回的值；搜索、选择和键盘交互不改变值、顺序或提交协议。
- 运行时页面使用可用视口与内部滚动边界，避免日志、滚动条和步骤切换触发外层布局跳动。
- 工具、任务、审批与快捷决策的终态只由 OpenClaw 返回；JunQi 仅呈现本地选择、请求中和上游已给出的
  状态，不能以图标或本地状态补足成功结论。
- Gateway 的真实排队项没有稳定的列表读取契约。会话停止继续使用精确 `runId` 的 `sessions.abort`，
  因而只停止当前 Run 并保留 Gateway 已接受的后续输入；这与“Stop 不清空 Task 记忆”的会话边界一致。
  现有 `messageQueue` 仅用于破坏性会话变更期间、尚未交给 Gateway 的本地交接窗口，不能视为或标注为
  Gateway 队列。
- 本地交接重试使用 `held` 状态而非 `queued`，防止消息状态、提示文本或操作按钮把未提交消息误报为
  Gateway 已接纳的队列项。

## 修改过的核心文件

- `src/pages/SetupPage/WizardScreen.tsx`
- `src/pages/SetupPage/wizard/WizardOptionSearch.tsx`
- `src/hooks/useSetupFlow/useWizardSession.ts`
- `src/components/setup/SetupFlowPanels.tsx`
- `src/motion/setupStepTransition.tsx`
- `src/components/Chat/ToolCallBubble.tsx`
- `src/components/Chat/ThinkingBubble.tsx`
- `src/components/Chat/ExecutionPlanCard.tsx`
- `src/services/chat/sendTransaction.ts`
- `src/components/Chat/message-input/SessionMutationHandoffPanel.tsx`
- `src/pages/QuickChatPage.tsx`
- `src/services/gateway/index.ts`
- `src/services/gateway/OpenClawSessionAbortClient.ts`
- `src/components/Chat/message-input/ComposerInputSurface.tsx`
- `src/components/Chat/QuickReplyBar.tsx`
- `src/components/Chat/InlineButtonBar.tsx`
- `src/components/Activity/OpenClawApprovalsPanel.tsx`
- `src/components/Activity/OpenClawTaskLedgerPanel.tsx`
- `src/AppRouteTree.tsx`
- `src-tauri/src/lib.rs`
- `specs/openclaw-agent-run-alignment.md`

## 测试与验证结果

- 合并后安装向导、取消、环境检测、步骤动效和选项搜索定向回归共 82 项通过。
- 合并后 `pnpm lint` 与 `git diff --check` 通过；模块边界检查覆盖 895 个文件，版本一致性检查通过。
- 合并后完整 `pnpm test`、`pnpm build`、`cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib` 与 `pnpm verify:openclaw-docs` 均通过；前端测试 2648 项通过，Rust 库测试 632 项通过、1 项忽略。
- 本轮会话、决策与账本定向回归 5 项通过；`pnpm lint`、TypeScript 检查与 `git diff --check` 通过。
  完整 `pnpm test` 当前为 2660 项通过，`pnpm build` 当前通过。
- 消息挤压的官方源码与协议审查已完成，未发现普通发送被 JunQi 本地队列模式替代；本轮未修改发送或
  停止行为，未执行真实 Gateway 压力测试。
- 本地交接窗口、`held` 状态和普通 Gateway `queued` 表达的定向回归 50 项通过；完整 `pnpm test`
  当前为 2661 项通过，`pnpm lint`、`pnpm build`、TypeScript 检查与 `git diff --check` 通过。

## 已知问题

- 真实 Tauri 环境检测视觉验收仍受 macOS 锁屏阻断，不能用浏览器或锁屏截图替代。
- 尚未在真实 OpenClaw 安装向导核验模型供应商完整列表、渠道多选长列表、亮暗主题和窄窗口。
- 尚未在 macOS、Windows、Linux 实际安装包完成窗口缩放、键盘焦点与长时间性能验收。
- 本地交接窗口没有真正 Gateway 压力场景的桌面实测。上游也未提供稳定的逐项队列读取协议，因此 JunQi
  不能展示、编辑或清空 Gateway 队列，只能呈现 Gateway 事件与消息投影。

## 已尝试但未完成的方案

- Tauri 开发进程可启动，但系统锁屏后无法采集应用画面；未尝试绕过系统解锁。

## 下一步开发顺序

1. 在可用的真实桌面与 OpenClaw 向导环境完成安装、环境检测、会话工具轨迹、审批和任务账本的视觉验收。
2. 使用真实 Gateway 制造同会话连续发送、followup、collect、steer、interrupt 与 Stop 场景，记录
   上游 ACK、转录、Run 与队列清理结果；随后在 macOS、Windows、Linux 分别记录窗口缩放、键盘焦点、
   减少动态效果和长时间运行的实际结果。
