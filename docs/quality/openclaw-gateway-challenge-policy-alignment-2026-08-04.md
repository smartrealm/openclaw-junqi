# OpenClaw Gateway 挑战与策略对齐审计

日期：2026-08-04

## 权威依据

- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol)：`connect.challenge`
  提供 `nonce` 与 `ts`；收到挑战后，设备认证客户端必须以 `ts` 填充
  `connect.params.device.signedAt`。`hello-ok` 的 `server`、`features`、`snapshot`、
  `auth` 与 `policy` 是正式响应字段。
- [OpenClaw gateway client](https://github.com/openclaw/openclaw/blob/main/packages/gateway-client/src/client.ts)：
  连接要求 challenge，并以服务端声明的 `policy.tickIntervalMs` 启动活动 watchdog。
- [OpenClaw device auth payload](https://github.com/openclaw/openclaw/blob/main/packages/gateway-client/src/device-auth.ts)：
  当前客户端设备签名使用 v3 payload，包含规范化后的 `platform` 与可选
  `deviceFamily`。
- [OpenClaw device-proof handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server/ws-connection/connect-device-proof.ts)：
  Gateway 校验挑战 nonce、签名时间与签名 payload；当前服务端仍可验证 v2，不能把旧
  兼容路径误作 JunQi 的目标实现。

## 审计范围

审查 `GatewayConnection` 的 WebSocket 生命周期、`connect.challenge`、设备签名 Tauri
command、`hello-ok` 状态提交、审批 transient socket、请求超时和连接存活检测。审查还覆盖
Rust command 注册、前端 IPC DTO、现有 MemoryWebSocket 回归夹具及运行时身份调用方。

## 发现

### GCP-01 严重：挑战时间没有进入设备签名

JunQi 只保留 `nonce`，Rust command 自行读取本机时钟并生成 v2 payload。官方协议要求使用
挑战的 `ts`；本机时钟漂移或服务端严格比较时，签名可被拒绝。当前官方客户端已经使用 v3
payload，因此继续生成 v2 只是在依赖服务端兼容分支。

### GCP-02 严重：两秒后 token-only 回退绕过当前握手要求

打开 WebSocket 两秒未收到 challenge 时，JunQi 会发送没有设备身份的 `connect`。当前官方
client 使用 `require-challenge`，无挑战应以连接失败处理，不能把旧 fallback 描述为跨版本
支持。

### GCP-03 高：不完整的 `hello-ok` 可提交连接状态

原实现只校验 protocol 并宽松读取 `features` 与 `auth`，缺失 `snapshot` 或 `policy` 的响应
也会启动轮询、保存 token、发布运行时身份。这样会把不符合 OpenClaw schema 的响应投影为已
连接状态。

### GCP-04 高：固定伪 ping 与官方策略脱节

旧定时器发送不含 `type: "req"` 的 `{ method: "ping" }`，该帧不符合 Gateway request
envelope，且不使用 `hello-ok.policy.tickIntervalMs`。官方客户端以收到的活动和服务端策略
watchdog 判定静默连接，而非创建未经协议证明的 ping RPC。

## 非问题

日常 operator socket 仅申请 `operator.read` 和 `operator.write`。审批事件与单次高权限
RPC 分别通过带 `operator.approvals` 或对应 scope 的 transient socket 发起，且 transient
socket 不持久化轮换 device token。这符合官方交互客户端 scope 模型和现有最小权限边界，
本轮不扩大日常 scope。

## 目标行为

1. 仅在收到合法 `nonce` 与非负安全整数 `ts` 后发送 `connect`；缺失或无效 challenge 关闭
   当前连接并走既有恢复路径。
2. Rust 与 TypeScript IPC 共同传递 challenge 时间、平台和可选设备族，按官方 v3 payload
   签名；空认证 token 保持为合法签名 payload 的空字段。
3. 只有完整且符合关键 schema 的 protocol v4 `hello-ok` 才能提交 methods、credential、
   runtime identity、轮询和已连接状态。
4. 发送入口在成功握手后以前置方式遵守 `policy.maxPayload` 与
   `policy.maxBufferedBytes`，并根据 `policy.tickIntervalMs` 和已接收 Gateway 活动关闭静默
   socket；不再发送未定义 ping RPC。有限超时 RPC 保持自己的 deadline；无界请求仍由连接
   watchdog 保护。

## 验证边界

- 定向回归覆盖 challenge 时间、v3 IPC 签名字段、无 challenge 拒绝、签名不可用失败关闭、
  无效 `hello-ok` 拒绝、policy 驱动的 watchdog，以及载荷和缓冲上限的本地拒绝。Rust 回归
  覆盖 v3 payload、空签名 token 与 challenge 时间输入验证。
- 已通过 `pnpm lint`、`pnpm test`（2,663 项前端测试与 245 项脚本测试）、`pnpm test:rust`
  （705 通过、3 跳过）、`cargo fmt -- --check`、`cargo check --lib`、`pnpm build`、
  `pnpm verify:openclaw-docs`、`pnpm collab:test` 与 `pnpm collab:validate`。定向 Gateway
  回归额外覆盖未完成 handshake 在截止时间关闭的行为；`git diff --check` 与本轮修改文件的
  Emoji 扫描也已通过。
- 自动化不能替代真实 Gateway 的密码、配对或 token 轮换验收。
- 本机自动化不能证明 macOS、Windows、CentOS 或 Ubuntu 的系统凭据库、睡眠恢复和实际
  WebSocket 行为；这些仍需各目标平台连接真实 Gateway 验收。
