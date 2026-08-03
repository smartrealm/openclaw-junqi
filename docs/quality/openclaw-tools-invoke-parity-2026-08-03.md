# OpenClaw tools.invoke 能力对齐记录

日期：2026-08-03

## 当前差距

JunQi 已经能读取 `tools.catalog` 和 `tools.effective`，但此前没有受控的工具调用入口。直接把
工具名交给 Gateway 会丢失会话归属、参数校验和用户确认边界；直接使用管理员连接也会扩大权限。

## 本轮处理

- 新增 `src/services/gateway/toolsInvoke.ts`，按当前 OpenClaw schema 构造并严格解析
  `tools.invoke`。
- 日常 Gateway 连接调用 `tools.invoke`，保留 `operator.write` scope；不把普通调用提升为
  `operator.admin`。
- Chat 上下文栏的 effective tools 面板只允许选择当前服务端投影中的工具，支持 JSON object
  参数、显式确认、一次性幂等键和临时结果展示。
- Gateway 返回的策略拒绝、需要审批和工具错误保持结构化，不生成本地成功状态。

## 验证

- 服务测试覆盖参数归一化、非法参数、成功结果、审批提示和错误结果。
- TypeScript、lint、全量前端与脚本测试、生产构建和 `git diff --check` 作为本轮交付门禁。

## 未验证边界

- 未用真实 Gateway 执行外部效果工具；owner-only wrapper、插件审批和 MCP transport 仍需目标
  Gateway 手工验收。
- 工具参数 schema 当前不在 `tools.effective` 返回中，面板不推断 schema，只接受 JSON object。
