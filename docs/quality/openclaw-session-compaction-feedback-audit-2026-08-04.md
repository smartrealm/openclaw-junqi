# OpenClaw 会话压缩异步反馈审计

日期：2026-08-04

## 证据与结论

JunQi 是 OpenClaw 的桌面客户端。安装版 OpenClaw `2026.7.1-2` 的官方
`openclaw sessions compact` CLI 在收到 `ok: true`、`compacted: false` 且
`result.details.pending: true` 时，明确呈现“压缩已开始，完成由后端异步报告”。
因此，`compacted: false` 不能单独等价为 no-op。

当前 JunQi 的 `OpenClawSessionCompactionClient` 只解码 `ok/key/compacted/reason`，
Dashboard 和命令面板都将所有 `ok: true`、`compacted: false` 结果显示为“未执行上下文
压缩”。这会把已受 Gateway 接纳的异步压缩错误表述为 no-op，用户会得到错误的操作状态。

## 权威依据

- 安装版 `dist/sessions-compact-CkevFtdS.js`：官方 CLI 对
  `result.details.pending === true` 输出“已开始，完成异步报告”。
- 安装版 `dist/core-descriptors-DRUtdasO.js`：`sessions.compact` 的权限是
  `operator.admin`。
- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)：
  `sessions.compact` 是 Gateway 管理的会话维护 RPC。
- [OpenClaw compaction concept](https://github.com/openclaw/openclaw/blob/main/docs/concepts/compaction.md)：
  Gateway 负责会话压缩及其持久化生命周期。

## 发现

### COMPACT-01 - 高 - 异步已启动被误报为 no-op

位置：`src/services/gateway/OpenClawSessionCompactionClient.ts`、
`src/pages/Dashboard/index.tsx`、`src/components/CommandPalette.tsx`

当前严格响应解码丢弃 `result.details.pending`，两个入口随后把
`ok: true`、`compacted: false` 一律分类为 no-op。这与同一安装版官方 CLI 的行为冲突。

影响：用户可能重复触发已经受 Gateway 接纳的压缩；Dashboard 与命令面板都会把“等待
Gateway 完成”错误显示为“没有执行”。本地也没有任何权威依据可把该结果改写成完成。

修复：仅在 `ok: true`、`compacted: false` 且官方嵌套标志严格等于 `true` 时保留
`pending`。将结果分类集中为失败、完成、已启动等待和 no-op；两个 UI 入口共用该分类。
完成仍只以官方 `session.operation` 终态或后续 Gateway 结果为准。

## 非问题

命令面板的 `gateway.compactSession` 调用已有 rejection handler，会把 Gateway、授权和
传输失败显示为错误 toast；本轮未发现未处理 Promise rejection。

## 验证

- `OpenClawSessionCompactionClient.test.ts` 覆盖官方请求字段、完成、no-op、pending、
  内部失败和非法响应。
- `sessionCompactionFeedback.test.ts` 覆盖 pending 与完成/no-op 的互斥分类，以及
  Gateway 拒绝和请求失败反馈。
- `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`、
  `pnpm collab:test`、`pnpm collab:validate`、`pnpm test:rust`、
  `cargo fmt -- --check`、`cargo check --lib` 和 `git diff --check` 均通过。

## 未验证边界

- 尚未连接真实 Gateway 验证异步 pending 到 `session.operation` 终态的时间线。
- 尚未在 macOS、Windows、CentOS 或 Ubuntu 真机验证 toast 与后台会话事件。
