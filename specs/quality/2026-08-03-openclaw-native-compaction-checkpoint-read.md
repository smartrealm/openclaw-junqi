# OpenClaw 原生压缩检查点只读规格

日期：2026-08-03

## 目标

Session Manager 只读取并呈现当前 OpenClaw Gateway 为某个 session 保存的 compaction checkpoint。

## 约束

1. 本轮只使用官方 `sessions.compaction.list`，且只传 schema 允许的 `key`；`list` 返回的完整 checkpoint metadata 是唯一展示来源。
2. 请求必须经过已认证 connection fence；Gateway 实际未知方法、连接变化或断线时失败关闭，发现列表遗漏不阻止请求。
3. 客户端严格验证 `ok`、canonical key、checkpoint identity、reason、时间、token 与 transcript 引用字段；无效响应不得部分投影。
4. 读取仅由用户显式展开或选择触发；不把会话的 `compactions` 数字当作 checkpoint 数量。
5. 不调用 `sessions.compaction.branch`、`sessions.compaction.restore`、`sessions.rewind`、`sessions.fork`、`sessions.compact` 或任何写 RPC。

## 验收条件

- 合法 Gateway 列表响应能显示 checkpoint metadata。
- 遗留 Gateway、拒绝、断线、畸形结果和迟到响应不会显示旧或本地生成的 checkpoint。
- 测试覆盖官方请求字段、枚举和响应解析、连接围栏、UI 的加载、空和失败状态。
