# OpenClaw Operator Protocol v4 对齐规格

日期：2026-08-03

## OPV4-01：只接受官方 operator/UI protocol v4

### 当前行为

JunQi operator/UI 请求范围包含 protocol v3，收到任意 `hello-ok` 后即建立本地
连接状态。protocol v3 只属于 OpenClaw node/probe N-1 窗口，不是 operator UI
契约。

### 目标行为

JunQi 发送 `{ minProtocol: 4, maxProtocol: 4 }`。只有合法 `hello-ok` 的
`protocol` 严格为 4 才能更新 capability、credential、runtime identity、连接状态和
轮询。其他 protocol 的 `hello-ok` 必须作为握手失败关闭当前 socket。

### 验收

- [x] 日常和临时 operator socket 均发送精确 v4 范围。
- [x] protocol v3 `hello-ok` 不保存 token、不发布 runtime identity、不发送后续 RPC，
  并关闭 socket。
- [x] protocol v4 `hello-ok` 保持既有 capability、credential 和身份围栏行为。
- [x] 运行时身份相关 operator 夹具不再使用 protocol v3。
- [x] TypeScript、定向回归、完整测试、构建、官方文档验证和差异检查通过。

## 约束

- protocol 值来自官方 Gateway protocol 常量；不得从 OpenClaw 软件包版本推断。
- 只在 operator/UI handshake 边界执行此规则；不得影响 node 或 probe 的官方兼容路径。
- 握手失败不得保留 device credential、identity、advertised methods 或伪造已连接状态。
