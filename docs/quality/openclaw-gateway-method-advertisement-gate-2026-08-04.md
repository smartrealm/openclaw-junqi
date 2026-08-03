# OpenClaw Gateway 方法广告发送门禁

日期：2026-08-04

## 结论

OpenClaw 的 `hello-ok.features.methods` 是当前连接实际暴露的 Gateway 方法集合。JunQi 已保存这个集合，
但通用 `GatewayConnection.request` 和 `requestFenced` 过去没有强制使用它，因此缺少专用 capability
检查的调用方仍可能向已明确不支持的方法发送请求。

JunQi 必须在传输边界拒绝已明确未广告的方法，且不得创建 request id、注册 callback 或写入 WebSocket。
广告未知时保留原有传输行为；只有完整 `hello-ok` 的明确缺失才是不可调用结论。

## 权威依据

- [OpenClaw Gateway client guide](https://docs.openclaw.ai/gateway/clients) 要求 operator client 在 `hello-ok`
  完成后以 Gateway 广告的能力运行，并以 `exec.approval.list` 回补事件。
- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol) 将 Gateway 方法集列为握手协议事实，
  并定义方法与 operator scope 的边界。
- [OpenClaw method registry](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods-list.ts) 是服务端
  实际方法的官方来源。
- 当前安装 OpenClaw 的 `schema-*.js` 将 `hello-ok.features.methods` 定义为非空字符串数组；其
  `server-methods-*.js` 与 `server-aux-methods-*.js` 用于复现本机运行时的方法注册。

## 当前与目标行为

- 修复前：专用 client 可自行检查广告，但直接使用 connection 的请求在广告明确缺失时仍会发送。
- 修复后：`request` 和 `requestFenced` 在 socket、连接和 identity 检查完成后，统一拒绝明确未广告的方法。
  拒绝是本地传输边界错误，不冒充 Gateway 已处理过的 RPC 错误。
- 不根据安装版本写死方法表，不以方法前缀、UI 状态或失败文本推测能力；唯一门禁是当前连接的
  `hello-ok.features.methods`。

## 验证结果

- `node --import ./test-setup.ts --import tsx --test src/services/gateway/Connection.queue.test.ts src/services/gateway/gatewayCredentialSecurity.test.ts`：39 个测试通过，覆盖普通请求和 identity-fenced 请求在明确缺失广告时均零发送、零 callback、零 request id，以及已广告方法仍可发送。
- `pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test`、`pnpm build`：通过。
- `pnpm verify:openclaw-docs`：通过，验证当前官方 `commands.list` 文档链接。
- `pnpm collab:test`、`pnpm collab:validate`：通过。
- `pnpm test:rust`：705 通过、0 失败、3 忽略。

## 未验证边界

- 当前工作区未连接真实 Gateway，尚未用真实 operator 角色复现被省略的插件或权限方法。
- macOS、Windows、CentOS 与 Ubuntu 的 WebView/Tauri 交互仍需各目标平台真机验证；本修复不改变平台 API。
