# OpenClaw 原生审批对齐

日期：2026-08-03

## 依据

本次实现以 OpenClaw 官方文档、Gateway protocol schema 和 handler 行为为契约。本机安装
版本只用于复现响应，不作为版本判断、能力开关或兼容分支。

- [`gateway/protocol.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
  定义 `exec.approval.list`、`exec.approval.resolve`、`plugin.approval.list`、
  `plugin.approval.resolve` 以及审批事件。
- [`operator-scopes.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/operator-scopes.md)
  定义 `operator.approvals`；`operator.admin` 满足所有 operator scope。
- [`exec-approvals.md`](https://github.com/openclaw/openclaw/blob/main/docs/tools/exec-approvals.md)
  规定 exec 审批由 Gateway 创建、通过 `exec.approval.resolve` 解析，并由 Gateway 负责
  超时、拒绝和 canonical system run plan 校验。
- [`exec-approvals.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/packages/gateway-protocol/src/schema/exec-approvals.ts)
  和 [`plugin-approvals.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/packages/gateway-protocol/src/schema/plugin-approvals.ts)
  定义审批 envelope、请求字段和 `allow-once`、`allow-always`、`deny` 决策值。
- 当前主线还提供统一的 [`approvals.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/packages/gateway-protocol/src/schema/approvals.ts)
  schema 和 [`approval.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/src/gateway/server-methods/approval.ts)
  handler：`approval.history` 只返回 terminal snapshot，`approval.get` 返回单条 pending 或
  terminal snapshot，`approval.resolve` 需要 `{ id, kind, decision }` 并返回 `applied` 与
  Gateway 记录的 terminal approval。

## 原问题

JunQi 之前只有 Chat transcript 中的 decision block 和 inline button。它们没有
`operator.approvals` 返回的审批 ID、决策确认或 Gateway 审批生命周期，不能被标记为正式
OpenClaw 审批。语音常驻场景下，如果桌面只展示文本而没有统一的原生待处理队列，用户无法
在响应外安全处理可能带副作用的命令或插件动作。

## 当前行为

- `OpenClawApprovalClient` 保留 OpenClaw 原生的两个 pending list 方法，同时按
  `hello-ok.features.methods` 接入统一 `approval.history`、`approval.get` 和
  `approval.resolve`。统一响应只接受官方脱敏 `ApprovalSnapshot`，涵盖 exec、plugin 和 system-agent，并保留 Gateway 的
  status、reason、source、resolver 与 canonical terminal decision。JunQi 不调用 approval
  request，不创建本地审批，不写入 exec policy，也不复制 Gateway 的超时、命令绑定或副作用
  执行逻辑。
- 读取、历史和解析通过只请求 `operator.approvals` 的专用 transient 连接完成。日常连接仍只
  申请 `operator.read` 与 `operator.write`，没有把 `operator.approvals` 或
  `operator.admin` 加入日常 scope；scope 拒绝不会回退为管理员读取。
- `hello-ok.features.methods` 明确没有某个 list 方法时不发起该 RPC；方法列表未知时按官方
  协议的保守发现语义真实尝试一次。Gateway 明确返回 method-not-found 时，该方法标记为
  不可用；认证、传输、参数或响应错误继续向 UI 抛出，不静默降级。
- 返回 envelope、时间戳、请求标题/描述/命令和允许决策均严格解码。统一 resolve 发送官方
  `{ id, kind, decision }`，旧 Gateway 才发送对应 family 的 `{ id, decision }`；决策必须出现在
  Gateway 返回的 `allowedDecisions` 中。统一 resolve 只接受官方 `applied` 和 terminal
  snapshot，旧路径只在 Gateway 返回 `ok: true` 后确认成功，随后重新读取 pending 队列。
- 活动中心增加 OpenClaw approvals 面板，显示 exec/plugin 类型、Gateway 返回的实际元数据、
  过期时间和真实决策按钮。没有返回决策选项时不自行补全按钮；断线、加载、空队列、协议不
  可用、错误和解析中状态均单独呈现。
- 面板使用 15 秒桌面轮询作为重新打开后的 pending 快照刷新。当前没有把
  `exec.approval.requested/resolved` 或 `plugin.approval.requested/resolved` 接入主连接事件
  路由，因此不声称实时事件订阅；轮询只是 JunQi 对原生 list RPC 的本地呈现策略。
- 面板同时按官方 `approval.history` 显示 terminal history，并按 `nextCursor` 请求后续页。
  历史只渲染官方脱敏 presentation，不把旧请求中的 cwd、环境键、system run plan 或其他
  运行时字段带入 UI。Gateway 未广告统一 history 时，面板明确显示不可用；不会把旧 pending
  快照伪装成统一历史。
- Chat 中既有的 `transcript-only` review 语义保持不变。原生审批队列不会被伪装成 Chat
  trace 节点，也不会把 inline button 的选择改写成正式审批。

## 验证结果

- `OpenClawApprovalClient.test.ts` 覆盖 exec/plugin list、统一 history/resolve、system-agent
  presentation、显式缺失能力、未知能力真实调用、method-not-found、严格响应、允许决策校验、
  resolve 回执和认证错误传播；store 测试覆盖 history cursor 分页去重。
- 已通过审批定向测试和 TypeScript 定向检查；完整 lint、测试、构建和官方链接校验均已通过，
  `git diff --check` 与本次修改文件的 Emoji 扫描也已通过。

## 未验证边界

尚未连接真实 Gateway 验证不同 OpenClaw 配置下的 pending 与统一 history/resolve 响应，也未在 Windows、
macOS、Linux 真机上手工验证 approvals scope 配对、Gateway 断线重连和多窗口轮询。审批策略
`exec.approvals.get/set`、approval waitDecision、`sessions.messages.subscribe` 的
`includeApprovals` 长连接、插件自定义 action 和 Gateway 端执行副作用不在本次范围内；这些
能力必须在取得当前官方 schema/handler 证据并完成权限链路设计后独立立项。
