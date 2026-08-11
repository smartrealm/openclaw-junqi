# OpenClaw AgentRun 对齐实施计划

更新时间：2026-08-11

## 范围

替换或删除当前本地 AgentRun 的 PTY、外部 CLI、任务状态和手工 worktree 路径。该工作不改变 OpenClaw
上游协议，也不增加 JunQi 自定义任务或 ACP 语义。

## 顺序

1. 完成引用图分组：路由与导航、任务持久化、动态岛与通知、工作台迁移、Tauri command、测试和文档。
   对每组确认真实消费者与删除边界。
2. 保留当前已验证的普通 Gateway `sessions.create` 与 Chat 导航路径；当前不为未验证的工作树参数新增前端字段、
   本地映射或入口。
3. 将活动、时间线、焦点、动态岛与通知改为只消费 Gateway 会话、任务账本和审计投影；删除本地任务的混合投影。
4. 删除 `AgentRunView`、AI 工作台、任务简报、`agentWorkspaceStore`、相关 Tauri command、专属 worktree 包装、
   路由、持久化、迁移与无消费者测试。
5. 执行协议定向测试、全局引用检查、TypeScript、Rust、生产构建和 macOS、Windows、Linux 桌面实测。

## 当前阻塞与边界

目前 JunQi 的会话创建客户端尚未传递上游工作树字段，且尚未针对当前运行时完成 `sessions.create` 托管工作树
的真实权限与返回结构验证。因此在第 2 步完成前，不得将本地 AgentRun 的参数映射为假定的 Gateway 行为。
