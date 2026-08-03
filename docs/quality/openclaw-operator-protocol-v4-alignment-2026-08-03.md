# OpenClaw Operator Protocol v4 对齐审计

日期：2026-08-03

## 依据

当前安装的 OpenClaw `2026.7.1-2` 随包
`docs/gateway/protocol.md` 与 `dist/schema-DtyqV_v0.d.ts` 均声明：

- `PROTOCOL_VERSION` 为 4；
- `MIN_CLIENT_PROTOCOL_VERSION` 为 4；
- protocol v3 的 N-1 兼容只适用于 `role: "node"` 且 `client.mode: "node"`
  的节点，以及轻量 restart probe；
- operator/UI 客户端必须在连接范围中包含当前 protocol v4。

官方当前协议文档同样要求 `hello-ok` 返回 `protocol`，并说明 JunQi 这类
operator UI 的连接运行 protocol v4。该版本值是 Gateway wire protocol 的稳定
契约，不是 JunQi 自行维护的 OpenClaw 软件版本支持区间。

## 发现

### OPV4-01 高风险：operator 握手仍允许 protocol v3 并接受任意 hello-ok

`src/services/gateway/Connection.ts` 当前发送 `{ minProtocol: 3,
maxProtocol: 4 }`，且只要响应形状为 `hello-ok` 就立即：保存设备 token、发布
运行时身份、启动轮询并报告已连接。

这会让 operator UI 在一个 protocol v3 Gateway 响应后继续消费只按 v4 设计的
chat、session、tool 和 Talk 投影。结果可能是“连接成功”但事件或字段语义已漂移，
而不是可诊断的协议拒绝。

## 目标

1. JunQi operator/UI 握手只发送 protocol v4 的精确范围。
2. 仅当 `hello-ok.protocol === 4` 时才进入已连接、写入设备 credential、触发
   runtime attestation 或启动轮询。
3. 非 v4 `hello-ok` 是握手失败：关闭当前 socket 并保留清晰的连接错误；不能生成
   runtime identity 或继续发送普通 RPC。
4. 单元测试中的 operator identity 夹具使用 v4，避免把 node-only protocol v3
   误作桌面 operator 样本。

## 不做的事情

- 不根据 OpenClaw 软件发布版本增加客户端版本白名单或黑名单。
- 不改变 node/probe 兼容窗口，也不让 JunQi 冒充 node 以获取 v3 兼容。
- 不改变 Talk、voicewake、session 或凭据 scope；这些仍以各自的 capability、scope
  和响应 decoder 为准。

## 验证与未验证边界

- 定向回归 100 项通过，覆盖 protocol v3 `hello-ok` 的拒绝关闭、credential 与
  runtime identity 不提交、无后续 RPC，以及 protocol v4 的既有日常和临时 socket
  行为。
- `pnpm lint` 通过，包含模块边界、版本一致性和 TypeScript 检查。
- `pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs` 与 `pnpm test:rust` 通过。
- 合入 `origin/main` 后，复审了会话列表竞态围栏与原生 group 约束。冲突保留了
  `sessionProjectionRevision`，同时维持 protocol 不支持时空的 renderer group 投影；
  启动页守护测试已由源码表达式匹配改为可执行的围栏状态测试，未改变运行时加载语义。

未连接真实 v3/v4 Gateway 进行协议协商抓包；该边界不能通过本机单元测试替代。
尚未在 macOS、Windows、CentOS 或 Ubuntu 的真实桌面制品上连接 v4 Gateway 验收。
