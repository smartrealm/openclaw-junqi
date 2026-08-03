# OpenClaw 会话上下文与检查点控制对齐

日期：2026-08-03

## 依据

当前安装的 OpenClaw 版本为 `2026.7.1-2 (0790d9f)`。本轮逐项核对随包
`schema-BuOFpc7K.js` 与 `sessions-UcKjjh_n.js`：

- `sessions.preview` 接收 `keys`，可选 `limit`、`maxChars`，返回 `ts` 与每个 key 的
  `status`、`items[{role,text}]`。
- `sessions.resolve` 接收 key/selector 与可选 agent scope，找不到时在
  `allowMissing` 下返回 `{ok:false}`，成功时返回规范化 `key`。
- `sessions.compaction.list` 接收 `key` 与可选 `agentId`，返回 `ok`、规范化 `key` 和
  `checkpoints`。checkpoint 包含创建时间、原因、token 计数、摘要以及压缩前后的 transcript
  引用。
- `sessions.compaction.get` 读取单个 checkpoint；`sessions.compaction.branch` 使用
  `operator.write` 创建新的会话；`sessions.compaction.restore` 使用 `operator.admin` 恢复
  当前会话，官方 handler 会处理中断运行与清空排队工作的生命周期门禁。

## 当前实现

JunQi 在 Gateway service 层新增严格的参数构建和响应解码，拒绝缺少 key、未知状态、错误
role、非法时间/token 或跨会话返回。Chat 的会话上下文栏新增一个图标入口，打开后读取并展示：

- 当前会话最近的 bounded transcript preview；
- Gateway 实际解析后的 canonical session key；
- 已记录的 compaction checkpoint 元数据。

组件通过 `useSessionInspection` 调用 service facade，未绕过服务边界直接访问连接对象，未把
原始 transcript 写入前端持久化。

每条 checkpoint 现在提供“创建分支”和“恢复到此处”两个操作。两者均通过确认弹窗触发；
同一 session key 的操作经过 `SessionCommandCoordinator` 串行化。branch 成功后只写入
Gateway 返回的真实新会话身份并切换到新标签；restore 成功后以返回的 `sessionId` 清理本地
旧 transcript 投影，再重新读取官方 preview、resolve 和 checkpoint 列表。

## 安全与行为边界

JunQi 不在本地实现 transcript 分支/恢复，也不把 checkpoint 摘要当作新的会话内容。branch
使用普通写权限连接，restore 使用一次性管理员连接；响应必须同时确认 canonical key、
sessionId、entry.updatedAt 与 checkpoint 结构，否则拒绝更新界面。restore 的运行中会话门禁、
队列清空和 transcript 边界由当前 OpenClaw handler 负责，JunQi 不猜测或复制其内部状态。

## 验证结果

- `sessionInspection.test.ts`：6 项协议参数/响应测试通过，覆盖 checkpoint get、branch、restore
  的身份 fence 与 entry 校验。
- `gatewayRecoveryRegression.test.ts`：固定官方 preview/resolve/list 入口与 checkpoint
  get/branch/restore client；会话上下文入口仍只通过 facade 触发。
- `pnpm exec tsc --noEmit` 通过。
- locale JSON 解析通过，`git diff --check` 通过。

## 未验证边界

- 未连接真实 Gateway 获取实际 preview、resolve、checkpoint 或 branch/restore 响应体。
- 未在真实 Gateway 验证 `operator.write`/`operator.admin` 授权、活动运行中断、队列清空或
  restore 后的 transcript 轮换。
- 未在 Windows、Linux 或 macOS 发布制品中进行真机 UI 验收；本轮 Windows 另有重启等待与
  停止态命令分支修复，但 Scheduled Task 真机行为仍需目标平台验证。
