# 会话维护与 OpenClaw 官方接口对齐

日期：2026-08-03

## 依据

- 当前安装的 OpenClaw `2026.7.1-2` `SessionsCompactParamsSchema` 与 `sessions.compact` handler。
- 官方参数要求 `key`，可选 `agentId` 和正整数 `maxLines`；返回包含 `ok`、规范化 `key` 和 `compacted`，没有 transcript 时以 `compacted: false` 返回原因。
- 官方 `SessionsPreviewParamsSchema`、`SessionsResolveParamsSchema`、`SessionsCompactionListParamsSchema`、
  `SessionsCompactionGetParamsSchema`、`SessionsCompactionBranchParamsSchema`、
  `SessionsCompactionRestoreParamsSchema` 以及对应 handler。

## 当前行为

JunQi Dashboard 的“压缩上下文”入口曾通过 `chat.send` 发送 `/compact`。这依赖聊天命令解释，而不是直接调用 Gateway 的会话维护能力，无法区分“请求已发送”和“会话确实完成了压缩”。

## 目标行为

- 入口改用 `sessions.compact`，参数直接使用官方顶层 `{ key }` 结构。
- 对返回的会话 key、`ok`、`compacted` 和可选字段严格解码；Gateway 返回其他会话时拒绝更新结果。
- 没有 transcript 时保留官方的 `compacted: false` 与 `reason`，不伪造为失败或成功。
- 该变更只替换已有 Dashboard 快捷入口，不改变用户会话内容或引入本地压缩实现。
- Chat 会话上下文栏已通过官方 `sessions.preview`、`sessions.resolve` 和
  `sessions.compaction.list` 展示最近转录、规范化 key 与 checkpoint 元数据；这些调用是
  只读的，不在前端复制 transcript 或猜测压缩结果。
- 每条已确认的 checkpoint 提供两个受控操作：
  `sessions.compaction.branch` 创建新的真实会话，`sessions.compaction.restore` 恢复当前
  会话。两者都要求先确认；操作期间同一 session key 通过 `SessionCommandCoordinator` 串行化。
- branch 使用日常 `operator.write` 连接，成功后只把 Gateway 返回的 `key`、`sessionId` 和
  `updatedAt` 写入本地会话投影；restore 使用一次性 `operator.admin` 连接，成功后以返回的
  `sessionId` 清除旧 transcript 投影并重新读取上下文。JunQi 不复制或本地修改 transcript。

## 验证结果

- `src/services/gateway/sessionMaintenance.test.ts` 覆盖参数构建、非法输入、不同会话响应、实际压缩和无 transcript 结果。
- `src/services/gateway/sessionInspection.test.ts` 覆盖 preview、resolve 与 checkpoint 的严格参数/响应解码、会话 key fence 和状态枚举。
- `gatewayRecoveryRegression.test.ts` 固定会话上下文栏使用官方 preview/resolve/list，并固定
  checkpoint get/branch/restore 由独立 service client 走正确协议入口。
- Dashboard 交互契约同步确认 `sessions.compact` 调用，而不再匹配 `/compact` 聊天消息。
- `pnpm lint`、`pnpm test` 与 `git diff --check` 在本次修改后执行。

## 未验证边界

- 尚未在真实 Gateway 上执行一次完整压缩，未验证当前凭据的 `operator.write` scope 与长耗时压缩期间的 UI 反馈。
- 尚未在真实 Gateway 上取得一次 preview、resolve 或 checkpoint 响应；当前开发机只做了本地官方源码与 schema 对照。
- 尚未连接真实 Gateway 执行 branch/restore；因此当前工作区没有声称已验证 Gateway 的
  `operator.write`、`operator.admin` 授权、活动运行中断、排队工作清空或 transcript 恢复结果。
- 未在 Windows、Linux 或 macOS 发布制品中完成人工 UI 验收；确认弹窗、窄窗口布局和连接
  断开后的错误提示仍需目标平台验证。
