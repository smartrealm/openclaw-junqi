# 跨运行审计账本规格

日期：2026-08-03

## 依据

本规格依据当前安装的 OpenClaw `2026.7.1-2 (0790d9f)` 随包官方文档。`audit.list` 是 `operator.read` 只读 RPC，接受可选的 Agent、session、run、kind、status、时间范围、limit 和 cursor，返回 metadata-only 的 newest-first 页面。

## 目标行为

1. 活动中心提供跨响应、跨会话的审计记录入口。
2. 默认请求最多 100 条记录；kind 和 status 筛选严格使用当前 OpenClaw 枚举。
3. 继续加载时只使用上一页返回的 `nextCursor`，不得用时间或本地排序猜测下一页。
4. 审计查询只走日常 `operator.read` 连接，不申请 `operator.approvals` 或更高权限。
5. 只展示已验证的 metadata-only 字段；查询失败、账本关闭、无权限或旧 Gateway 时，明确显示不可用，不覆盖其他活动数据。
6. Chat 追溯仍要求精确 `runId`，跨运行入口不得反向猜测或填充某个响应的 run identity。

## 验收条件

- [ ] `audit.list` 的 kind、status、limit 和 cursor 请求字段与本机官方协议一致。
- [ ] malformed 页或事件失败关闭，不将原始 payload 写入前端状态或持久化。
- [ ] 筛选变化会丢弃旧页并从第一页重新查询；分页结果按 Gateway 返回顺序追加。
- [ ] 断线、权限不足和账本无记录均有区分于成功数据的不可用/空状态。
- [ ] 中英文与繁体中文资源齐全。
- [ ] 定向测试、TypeScript、边界检查、完整测试、生产构建和 `git diff --check` 通过。

## 不在范围内

- 不把审计事件重建为 transcript。
- 不把 metadata-only 审计记录升级为审批记录。
- 不实现 `agentId`、`sessionKey`、时间范围的额外 UI 输入；协议支持这些过滤器，但本轮先交付跨运行 kind/status 查询，避免伪造当前业务上下文。
