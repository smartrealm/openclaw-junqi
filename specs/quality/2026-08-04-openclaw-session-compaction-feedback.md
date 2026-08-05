# OpenClaw 会话压缩异步反馈规格

日期：2026-08-04

## COMPACT-01 - 正确投影异步已启动状态

### 当前

`OpenClawSessionCompactionClient` 删除官方 `result.details.pending` 线索；两个 UI
入口将全部 `ok: true`、`compacted: false` 结果显示为 no-op。

### 目标

客户端只投影当前官方 CLI 已使用的窄字段：当且仅当 `ok: true`、`compacted: false` 和
`result.details.pending === true` 时，结果为 Gateway 已接纳的异步 pending。结果分类为
失败、已完成、等待 Gateway 完成或 no-op，Dashboard 与命令面板共享同一分类。

### 约束

1. 不透传或依赖 `result` 的其他未知字段，不由 JunQi 生成 pending、runId、队列状态或
   完成事件。
2. `ok: false` 始终优先作为失败；`compacted: true` 是已完成；只有精确的 pending 标志
   才是已开始等待；其余 `compacted: false` 保留为 no-op。
3. pending 不能写入 transcript、增加本地 compaction count 或显示为完成。
4. `session.operation` 仍是 UI 中压缩进度和完成状态的实时 Gateway 事件来源。
5. Gateway RPC rejection、授权错误和传输错误继续显示失败，不伪造远端取消或终态。

### 验收

- 解码器保留合法的官方 pending 线索，忽略未知的嵌套扩展字段。
- 结果分类器对失败、完成、pending、no-op 互斥且完整。
- Dashboard 与命令面板对 pending 显示“已开始，等待 Gateway”，不显示完成或 no-op。
- 两个入口对 rejection 都显示失败反馈。
- 回归、TypeScript、边界、构建与文档校验通过；真实 Gateway 和跨平台边界记录为未验证。
