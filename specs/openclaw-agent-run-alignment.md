# OpenClaw AgentRun 对齐规格

更新时间：2026-08-11

## 现状与依据

`AgentRunView`、`agentWorkspaceStore`、`agent_task_pty.rs` 与 `git_neu.rs` 当前共同维护本地任务、PTY、
外部 CLI、工作树和状态迁移。这些状态不由 OpenClaw Gateway 产生，不能作为 JunQi 的 Agent、任务或会话能力。

最新版 OpenClaw 的正式能力包括：

- `sessions.create` 可创建 Gateway 拥有的会话，并支持 `cwd`、`worktree`、`worktreeBaseRef` 和
  `worktreeName`；托管工作树由 Gateway 负责创建和归属。
- `tasks.*` 是后台工作活动账本，不是客户端调度器。
- ACP Agents 由 OpenClaw ACP 运行时与会话控制面拥有；客户端不得以本地 PTY 或外部 CLI 伪造 ACP 会话。

依据：

- https://docs.openclaw.ai/gateway/protocol
- https://docs.openclaw.ai/concepts/managed-worktrees
- https://docs.openclaw.ai/tools/acp-agents
- https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions-create.ts

## 目标行为

1. 新建编码会话只通过已经认证的 Gateway `sessions.create` 创建；本地缓存仅在 Gateway 返回稳定会话身份后建立投影。
2. 用户选择受支持的工作目录和工作树选项时，只提交上游定义的字段；Gateway 的成功、权限、校验或不支持响应是唯一结果依据。
3. 会话进入现有 Chat 路径；消息发送、停止、历史、工具调用、审批和任务账本继续使用现有 OpenClaw Gateway
   适配层。
4. ACP 专属控制只有在官方能力、认证权限和本次结构化响应均已确认时才展示；未确认时显示不可用，不模拟
   Codex、Claude 或其他外部 CLI。
5. 旧本地任务、PTY、外部 CLI 和手工 worktree 调度没有消费者后必须连同路由、持久化、通知、动态岛、
   测试和文档一并删除；不保留兼容、迁移或 fallback。

## 本次实施决策

当前普通会话创建已通过 Gateway `sessions.create` 完成，并且只在返回稳定会话身份后进入 Chat。相反，当前
运行时尚未完成托管 worktree 参数的真实权限与结构化回执验证。基于该证据，本次不把本地 AgentRun 参数
猜测性映射为 Gateway 请求，也不保留“本地执行”入口；直接删除整条本地 AgentRun、AI 工作台和任务简报
产品链。后续只有在官方工作树或 ACP 能力经本次 Gateway 响应验证后，才能新增相应会话入口。

## 验收条件

- 前端不存在 `run_task`、`agent_send_input`、`agent_resize_pty`、`cancel_task`、`complete_task` 或
  `reset_task_process` 的 Tauri 调用。
- Rust 不再注册上述本地 AgentRun command，且本地 PTY 与任务专属工作树实现已删除。
- 新建工作树会话请求与 `sessions.create` 官方 schema 一致，并且只在 Gateway 返回会话身份后导航。
- Gateway 不支持、未授权或校验失败时不创建本地任务、不显示成功、不自动降级到本地 CLI。
- 任务和活动界面只投影 Gateway `tasks.*`、会话和审计结果；不将客户端本地状态与上游任务混合排序。
- 删除完成后，全局引用图、定向回归、TypeScript、Rust、生产构建与目标平台桌面实测均通过。
