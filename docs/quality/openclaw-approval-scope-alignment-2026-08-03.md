# OpenClaw 审批最小权限对齐

日期：2026-08-03

## 结论

JunQi 是 OpenClaw Gateway 的桌面客户端。审批读取、历史和决策应请求官方指定的
`operator.approvals` scope，而不是复用泛化管理操作的 `operator.admin` 临时连接。

此前 `OpenClawApprovalClient` 的所有 RPC 都经由 `createPrivilegedRequester`，后者固定
建立 `operator.admin` transient socket。当前 OpenClaw method scope 和审批授权源码已经将
`approval.*`、`exec.approval.*` 和 `plugin.approval.*` 定义为独立审批权限。用管理员权限
读取本应由审批 scope 过滤的 pending list，既扩大了授予范围，也把管理员可见性误当作普通
桌面审批面板的可见性。

## 权威依据

- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol)
- [OpenClaw Gateway client guide](https://docs.openclaw.ai/gateway/clients)
- [OpenClaw approvals CLI](https://docs.openclaw.ai/cli/approvals)
- [OpenClaw approval authorization](https://github.com/openclaw/openclaw/blob/main/src/gateway/operator-approval-authorization.ts)
- [OpenClaw method scopes](https://github.com/openclaw/openclaw/blob/main/src/gateway/method-scopes.ts)

官方 `operator-approval-authorization.ts` 规定：带 device identity 的
`operator.approvals` 客户端可以审阅安全审批投影；`operator.admin` 才获得不受 reviewer
binding 限制的广泛访问。`approval.history`、`approval.get`、`approval.resolve` 及 legacy
exec/plugin approval methods 都由 approvals scope 保护。管理员可以满足该权限，但不是
JunQi 的默认或必要请求。

官方 client guide 同时建议具备 `operator.approvals` 的客户端在 `hello-ok` 后安装审批事件
监听，并用 `exec.approval.list` 回填连接前的请求。当前 JunQi 日常连接只请求
`operator.read/write`，审批访问是短生命周期连接；它没有经用户授权的常驻 approval
observer，因此不能声称实时事件已接入。

## 审计发现

### AS-01 - 高 - 审批客户端错误请求管理员 scope

位置：`src/services/gateway/index.ts`、`src/services/gateway/Connection.ts`

`createPrivilegedRequester` 固定传入 `scopes: ['operator.admin']`。审批 client 以这个
requester 调用 `exec.approval.list`、`plugin.approval.list`、`approval.history`、
`approval.get` 和 `approval.resolve`。这将受限 reviewer 本应看到的审批范围扩大为管理员
范围，并要求用户为审批面板额外批准与操作无关的管理权限。

修复在 transient requester 中显式支持调用方提供已验证 scope 集合。通用管理 requester
仍保持 admin；审批 client 单独使用只含 `operator.approvals` 的短生命周期 requester。
Gateway 拒绝 scope、设备 identity 缺失、配对取消、传输失败或请求失败时必须维持现有错误
语义，不能回退到 admin 或空成功。

### AS-02 - 中 - 审批面板尚无实时事件观察连接

位置：`src/components/Activity/OpenClawApprovalsPanel.tsx`、
`src/services/gateway/index.ts`

面板当前每 15 秒读取 pending list。官方事件存在，但日常 socket 没有 `operator.approvals`；
为追求实时性而直接提升每日 socket 至 approvals 或 admin，会改变连接配对、设备凭据、
断线恢复与用户授权模型。现有代码没有可复用的、用户可见且经审批 scope 配对的 persistent
observer 生命周期。

本轮不伪造事件订阅、不会让普通 event router 猜测未被授予的 payload，也不会把轮询说成
实时。后续仅当官方事件 payload、授权连接生命周期、一次连接的 backfill 顺序及多窗口
ownership 都有完整设计和真机证据时才单独接入。

## 当前行为

1. 日常 Gateway socket 继续只请求 `operator.read` 与 `operator.write`。
2. 打开审批面板、读取 history 或提交决策时，JunQi 创建短生命周期
   `operator.approvals` socket；不会提升为 admin fallback。
3. Gateway 的 visibility、reviewer binding、device identity、首次决策获胜和 terminal
   snapshot 仍完全由 OpenClaw 决定；JunQi 只显示成功 RPC 返回的投影。
4. 15 秒轮询仍是本地呈现策略，不被描述成实时订阅。

## 验证

- Gateway credential security 回归断言通用管理 requester 仍请求 admin，而指定 scope 的
  requester 只请求 approvals，且 transient device credential 不持久化。
- 审批 client/store 回归继续覆盖 scope 拒绝与 RPC 错误向 UI 传播，不能以空列表掩盖。
- 2026-08-03 已通过审批 client/store 与 credential security 定向测试、`pnpm lint`、
  `pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`、`pnpm test:rust`、
  `pnpm collab:test`、`pnpm collab:validate`、`git diff --check` 与 Emoji 扫描。
- 完整前端测试仍输出既有 React SSR `useLayoutEffect` 警告；Rust 检查仍输出
  `src/commands/system.rs` 的既有未使用变量警告。两者未导致本轮命令失败，且本轮未修改
  对应实现。

## 未验证边界

- 尚未在真实 Gateway 上用 device-token 和 token-only 身份分别验证 approvals-only 的
  reviewer visibility；缺少 device identity 时，Gateway 应按官方授权逻辑拒绝或限制可见性，
  JunQi 不使用 admin 规避。
- 尚未实现或验收 OpenClaw approval event 的常驻观察连接、backfill、重连和多窗口 ownership。
- 未在 macOS、Windows、CentOS、Ubuntu 真机验证审批 scope 的配对、凭据与断线恢复。
