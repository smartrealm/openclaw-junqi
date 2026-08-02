# OpenClaw 原生会话预览对齐规格

日期：2026-08-03

## 目标

Session Manager 使用 OpenClaw 官方 `sessions.preview` 展示真实会话的有限最近消息，
并在 Gateway 不支持或返回不可验证数据时保持诚实的不可用状态。

## 约束

1. 请求字段、响应结构、角色、状态和权限以官方 schema、handler 和方法目录为准。
2. JunQi 通过当前 Gateway 连接使用 `operator.read`，不提升为管理员权限。
3. 每次 RPC 最多发送官方 handler 接受的 64 个 key；更大的会话列表由客户端分批。
4. `limit` 和 `maxChars` 只用于限制桌面展示，不改变 Gateway 的 transcript 或 Task。
5. 响应缺少 key、出现重复 key、未知状态、非法角色或非空错误项时，整批失败并清除
   相关旧预览；不得展示猜测数据。
6. 断线、会话删除和旧连接迟到响应不得把旧内容带回当前界面。

## 验收条件

- 有能力时，Session Manager 卡片显示 Gateway `ok` 状态中最后一条非空文本。
- `empty` 显示空状态；`missing`、`error`、未声明能力和无效响应分别保持不可用或
  加载失败，不伪造 transcript。
- 单次请求不会超过官方 64-key 限制，且请求包含合法的 `keys`、`limit`、`maxChars`。
- 预览缓存按当前 Gateway 连接和 session key 绑定，刷新与断线后旧响应无法污染新状态。
- 自动化验证记录真实通过项，并明确真实 Gateway 与 macOS、Windows、CentOS、Ubuntu
  尚未完成的现场验证。
