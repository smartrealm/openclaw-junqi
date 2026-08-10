# OpenClaw 原生会话变更边界规格

## BUG-SM-01 协作插件阻断原生会话变更

### 当前

删除和重置在协作插件可用时必须先完成 `junqi.collab.session.mutation.prepare`。无活动协作运行也会要求该非原生写入成功；失败时 `sessions.delete` 或 `sessions.reset` 不会调用。

### 目标

删除直接调用 `sessions.delete`，重置直接调用 `sessions.reset`。请求使用已确认的会话 key、作用域智能体和删除所需 `expectedSessionId`。Gateway 回执是唯一成功事实。

协作运行仅在原生操作成功后清理 JunQi 本地展示投影，不参与 Gateway 会话生命周期的授权、围栏、重试或完成判定。

### 验收

- [x] 协作插件存在、不可用或写入失败时，JunQi 不调用其会话变更 RPC。
- [x] 删除只在 Gateway 明确确认删除后清理本地会话投影。
- [x] 重置只在 Gateway 明确返回新会话身份后替换本地身份和 transcript 投影。
- [x] 删除和重置失败时保留本地会话投影，并展示 Gateway 错误。
- [x] 不再存在会话变更对话框、协调器、状态仓或专属 RPC 客户端消费者。
- [x] 定向回归、类型检查、模块边界检查和构建通过。

## 验证记录

2026-08-10：生命周期、删除、重置、协作客户端、协作解码与会话目标定向回归共 55 项通过；`pnpm lint`、`pnpm build`、`pnpm collab:validate` 与 `git diff --check` 通过。真实多智能体 Gateway 与 Tauri 窗口验收尚未执行。
