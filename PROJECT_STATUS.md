# 项目交接状态

更新时间：2026-08-12

## 当前目标

`Blues-Code/Jarvis` 的 OpenClaw 原生交互与任务边界收敛已合入 `main`，本地开发分支已统一到同一提交；下一阶段是远端同步与真实桌面验收。

## 已完成内容

- `v3.1.0` 已从提交 `e17676dd5cf2b58207f5f720fdb3412d639a99f3` 发布，远端 CI 与三平台 Release 均成功。
- 已按共同祖先核对本地与远端开发分支；只有本地 `Blues-Code/Jarvis` 存在 main 之外的两个独有提交。
- Jarvis 独有提交删除了没有 OpenClaw 官方协议依据的本地 AgentRun、AI 工作台、任务简报、PTY、手工 worktree 调度和专属持久化链路。
- 会话、工具轨迹、审批、任务账本、计划和破坏性会话变更期间的消息交接继续使用 OpenClaw Gateway 的真实状态与派生投影。
- 向导与聊天交互继续复用现有 Aegis 主题 token、可访问状态和减少动态效果边界。
- 本地 `Blues-Code/Jarvis`、`Blues-Code/code`、`Blues-Code/dingtalk` 和 `daxia` 已快进到 main，不存在分支间代码差异。

## 关键技术决策

- JunQi 不以本地 PTY、外部 CLI、任务状态机或手工工作树模拟 OpenClaw Agent、Task、ACP 或会话语义。
- 普通会话只通过已认证 Gateway 创建；托管 worktree 与 ACP 能力只有在官方协议、权限和结构化响应均核验后才能增加入口。
- Gateway 未提供稳定的逐项消息队列读取契约。本地消息交接只表示尚未提交给 OpenClaw 的消息，不得显示为 Gateway 已接纳或执行成功。
- 工具、任务、审批、快捷决策和计划的终态只取自 OpenClaw 返回；JunQi 本地选择和请求中状态不能补足成功结论。
- 分支整合只处理已提交历史；脏工作树和无权威依据的独有实现不得因分支拉齐而被隐式合并。

## 核心文件

- `specs/openclaw-agent-run-alignment.md`
- `plans/openclaw-agent-run-alignment.md`
- `src/AppRouteTree.tsx`
- `src-tauri/src/lib.rs`
- `src/components/Activity/OpenClawTaskLedgerPanel.tsx`
- `src/components/Chat/ExecutionPlanCard.tsx`
- `src/components/Chat/ToolCallBubble.tsx`
- `src/components/Chat/message-input/SessionMutationHandoffPanel.tsx`
- `src/services/chat/sendTransaction.ts`
- `src/pages/QuickChatPage.tsx`

## 测试与验证

- Jarvis 分支合并前的工作树状态、共同祖先、独有提交和删除范围已核对。
- `v3.1.0` 发布提交的 `pnpm lint`、`pnpm test`、`pnpm test:rust`、`pnpm build` 与远端 CI 已通过。
- 本次合并后的 `pnpm lint` 通过，模块边界检查覆盖 895 个文件，版本一致性与 TypeScript 检查通过。
- 本次合并后的 `pnpm test` 通过，脚本测试 238 项通过；完整前端测试链路无失败。
- 本次合并后的 `pnpm test:rust` 通过，632 项通过、1 项忽略；`cargo fmt -- --check` 与 `cargo check --lib` 通过。
- 本次合并后的 `pnpm build` 通过，协作插件、钉钉业务插件、TypeScript 与 Vite 生产构建完成。
- `pnpm verify:openclaw-docs` 通过，当前官方 OpenClaw 命令文档链接可核验。

## 已知问题

- 合并后的大范围删除尚未完成 macOS、Windows 与 Linux 桌面真机验收。
- 托管 worktree 与 ACP 的当前 Gateway 权限和返回结构尚未完成真实运行验证，因此没有新增对应入口。
- OpenClaw 未提供稳定的 Gateway 队列逐项读取协议，JunQi 不能展示、编辑或清空 Gateway 内部队列。

## 下一步顺序

1. 经用户明确授权后推送 main 与已拉齐的开发分支，并核对远端提交身份。
2. 在真实 Gateway 与目标桌面环境验证会话连续发送、停止、审批、任务账本和窗口交互。
