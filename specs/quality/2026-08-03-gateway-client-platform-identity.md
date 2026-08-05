# Gateway Client 平台身份规格

## 目标

让 JunQi 的 OpenClaw Gateway 握手使用原生桌面平台身份，避免 WebView UA 和默认值改变
设备配对元数据。

## 当前行为

`GatewayConnection` 从 `navigator.userAgent` 推断平台；不能识别时返回 `windows`。该值被
写入 OpenClaw `connect.client.platform`。

## 目标行为

1. 前端通过注册的 `get_platform_info` Tauri command 读取原生 OS。
2. `darwin`、`windows`、`linux` 分别映射为 `macos`、`windows`、`linux`。
3. 原生读取失败、返回格式无效或 OS 不在已知映射中时，平台标签必须为 `unknown`。
4. WebView 字符串只能作为非 Tauri 环境的次级提示，未知值不得映射为 Windows。
5. `client.platform` 和握手 `userAgent` 必须使用相同的平台标签。
6. 设备签名或平台读取完成后，只有仍属于同一 socket 和同一 handshake ID 的流程可以发送
   `connect`；过期流程不得把旧请求发送到新 Gateway。

## 验收条件

- [x] Tauri wrapper 调用 `get_platform_info` 并严格校验 `os` 与 `arch`。
- [x] Gateway 连接在原生返回可用时优先使用该平台值。
- [x] 无原生平台信息时，macOS、Windows、Linux 的显式 WebView 标识可识别，其他值保持
  `unknown`。
- [x] 回归测试证明未知宿主不会发送 `windows`。
- [x] 回归测试证明连接切换会使旧握手失效，且不发送旧 `connect` 请求。
- [x] Tauri command 注册、TypeScript wrapper、握手 payload 和测试通过。

## 验证记录

当前代码以 `get_platform_info` 的 `os` 值优先构建 `client.platform`；仅在 Tauri 信息不可
用时读取 WebView hints，未知值保持 `unknown`。`Connection.queue.test.ts` 覆盖原生优先、
未知宿主与异步握手轮换围栏；`tauriCommandsContract.test.ts` 覆盖前端 command wrapper 和
Rust 注册契约。2026-08-04 全量 `pnpm lint`、`pnpm test`、`pnpm test:rust`、`pnpm build` 与
`git diff --check` 均通过。

真实 macOS、Windows、CentOS、Ubuntu 的设备配对、系统凭据库与断连恢复仍需在目标主机连接
真实 Gateway 后单独验收，不能由上述自动化替代。
