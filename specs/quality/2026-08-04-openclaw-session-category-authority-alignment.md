# OpenClaw 会话 category 权威性规格

## 问题

JunQi 将不存在于 OpenClaw 的 `sessions.groups.*` 当作原生能力，实现了客户端伪造的 group catalog
与全局组操作。

## 约束

- `sessions.patch.category` 是唯一可用的 category 写入方法；`null` 仅清空当前 session 的 category。
- 分类列表只能由已确认的 Gateway session snapshot 中非空 category 派生，不可持久化为本地 catalog。
- 不创建、改名、删除全局 category，也不通过多 session patch 模拟这些不存在的能力。
- 单 session category patch 必须确认 `ok: true`、目标 key 和 entry 中的实际 category，之后才能更新
  本地会话投影。
- Jarvis 唤醒词 category 只能在 Gateway 确认 wake trigger 后写入同一 active session。
- Gateway 不可用、响应畸形或连接切换时失败关闭，不显示或保留本地伪 category 成功状态。

## 验收条件

- [x] 生产代码没有 `sessions.groups.*` RPC、group catalog client 或相关 UI 操作。
- [x] 菜单和侧栏仅显示当前 Gateway session snapshot 派生的 category。
- [x] Jarvis 唤醒经过确认的 `sessions.patch.category` 后立即更新同一 session 的本地投影。
- [x] 清空 category 不会影响其他 session；改名、删除等不存在的操作没有客户端入口。
- [x] 相关回归、TypeScript、边界、全量测试、构建和文档检查通过。
