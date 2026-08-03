# Gateway Task Ledger 详情规格

日期：2026-08-03

## 依据

本规格依据当前安装的 OpenClaw `2026.7.1-2 (0790d9f)` 随包
`docs/gateway/protocol.md`。`tasks.get` 是要求 `operator.read` 的只读 RPC，参数为
`{ taskId: string }`，返回 `{ task: TaskSummary }`；任务不存在时由 Gateway 返回
not-found 错误，不应被客户端伪造成空任务。

## 目标行为

1. 活动中心的 Gateway task ledger 每条任务都提供详情展开入口。
2. 展开时调用官方 `tasks.get`，不依赖列表摘要猜测完整状态，也不调用更高权限连接。
3. 仅展示已由客户端严格解析的 `TaskSummary` 字段：身份、运行时、Agent、会话、流程、时间、进度、终态摘要和脱敏错误。
4. RPC 失败、任务被删除、权限不足或断线时，保留列表摘要并在该任务详情区显示不可用，不伪造成功或空详情。
5. 详情读取不持久化，不复制原始 Gateway 响应或运行内容。

## 不在范围内

- 不实现 `tasks.audit`、`tasks.maintenance` 或 Task Flow；这些能力需要独立的权限、维护语义和持久化边界。
- 不改变 `tasks.list` 的分页和排序协议。
- 不把 `tasks.get` 的 not-found 错误转换为本地已完成或已取消状态。

## 验收条件

- [x] `tasks.get` 请求参数和返回 envelope 与当前官方协议完全一致。
- [x] 缺少或非法 `task`、任务 ID 和 TaskSummary 字段时客户端失败关闭。
- [x] 活动中心详情入口使用稳定的 icon、键盘可达的按钮和三语文案。
- [x] 详情请求失败不会清除已加载的任务列表。
- [x] 定向测试、TypeScript、模块边界、完整测试、生产构建和差异检查通过。

## 未验证边界

- 未在真实 Gateway 上验证当前凭据的 `operator.read` scope 和任务被删除时的 not-found UI。
- 未在 Windows、macOS、Linux 真机上验证窄窗口和真实任务字段组合的视觉表现。
