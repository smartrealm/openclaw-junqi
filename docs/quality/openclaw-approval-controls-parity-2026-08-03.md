# OpenClaw 审批控制能力对齐

日期：2026-08-03

## 依据

本机安装的 OpenClaw 版本为 `2026.7.1-2 (0790d9f)`。本轮核对了随包的
`docs/gateway/protocol.md`、`docs/gateway/operator-scopes.md`、
`dist/schema-BuOFpc7K.js`、`dist/exec-approval-DRfKKxhu.js`、
`dist/plugin-approval-C2VV4Mty.js` 和 `dist/approval-shared-BKEyXMsJ.js`。

官方契约确认如下：

- `exec.approval.list` 和 `plugin.approval.list` 返回待处理记录数组；每条记录包含
  `id`、`request`、`createdAtMs` 和 `expiresAtMs`。
- `exec.approval.resolve` 与 `plugin.approval.resolve` 使用 `{ id, decision }`，最终
  可用决策由 Gateway 在请求记录的 `allowedDecisions` 中确定。当前安装版的决策值为
  `allow-once`、`allow-always`、`deny`。
- `exec.approval.requested` / `resolved` 与 `plugin.approval.requested` / `resolved`
  是 Gateway 广播事件。
- 审批 API 需要 `operator.approvals`。该权限不应加入 JunQi 日常连接；
  `operator.admin` 只在其他管理操作需要时使用。

## 当前行为

JunQi 之前没有调用任何审批 RPC，Chat 内联按钮只代表 transcript-only 的普通消息
交互，不能回答命令执行或插件敏感动作是否经过 Gateway 正式审批。

## 目标行为与实现

- `src/services/gateway/approvals.ts` 严格解析 exec/plugin 待审批记录、解析响应和事件。
  前端只保留命令、标题、描述、来源和会话等必要展示字段，不读取或持久化环境变量、
  `systemRunPlan`、原始参数或其他敏感扩展字段。
- `createPrivilegedRequester` 支持声明最小 scope。审批客户端使用单独的
  `operator.approvals` 临时连接，普通 Gateway 连接仍只请求 `operator.read` 和
  `operator.write`。
- 活动中心新增 Gateway 审批区域：用户明确打开活动中心时读取 pending 列表，按 Gateway
  返回的允许决策显示按钮；每次解析前确认，成功后只在 Gateway 确认响应后移除本地记录。
- `approvalEventBridge.ts` 识别官方 requested/resolved 事件。活动中心打开期间通过
  `GatewayApprovalEventSubscription` 维持一条只声明 `operator.approvals` 的 transient
  专用连接；页面卸载立即释放该连接。事件缺失、连接失效或 scope 不可用时，刷新列表仍是
  权威恢复路径。
- `allow-always` 不被 JunQi 自动推断或替换为一次性允许；按钮只按 Gateway 的明确允许集合
  渲染。

## 失败关闭

- 列表、请求、时间戳、决策或解析响应字段不符合当前协议时，整条记录拒绝进入 UI。
- 未获得 `operator.approvals`、Gateway 不可达或响应异常时显示不可用状态，不显示空列表为
  成功，也不执行任何默认决策。
- Chat 内联按钮、Collaboration decision block 与 Gateway exec/plugin approval 仍是三种
  不同机制，不能互相升级语义。

## 验证

- `approvals.test.ts` 覆盖 exec/plugin 列表解析、默认决策边界、敏感字段不进入投影、事件
  解析、严格失败和解析调用参数。
- `gatewayCredentialSecurity.test.ts` 覆盖审批临时 socket 只请求 `operator.approvals`，
  且不扩大日常连接 scope、不持久化临时凭据。
- `approvalEventSubscription.test.ts` 覆盖专用事件连接的 scope、事件转发、连接释放和
  主连接身份变化后的 fail-closed 行为。
- `pnpm test`：前端 2352 项、脚本 234 项全部通过；审批定向测试与 `pnpm lint` 通过。
- `pnpm collab:test`：368 项全部通过；`pnpm collab:validate` 和 `pnpm build` 通过。
- `pnpm verify:openclaw-docs` 验证 55 个官方链接和锚点；`git diff --check` 通过。

## 未验证边界

- 尚未连接真实 Gateway 执行一次待审批命令和一次插件审批，未取得当前配置下的真实
  `allowedDecisions`、事件顺序或 scope 升级响应。
- 当前专用连接只在活动中心打开期间存在，最多按固定次数重试；未获得 scope 或 Gateway
  不可达时不会扩大权限或伪造事件，列表刷新仍是恢复路径。
- 未在 Windows Scheduled Task、Linux systemd 或 macOS 发布制品上完成真实审批操作和权限
  验收。
