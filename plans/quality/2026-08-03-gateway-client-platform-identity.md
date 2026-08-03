# Gateway Client 平台身份实施计划

## 依据

OpenClaw `connect` 的设备元数据处理、JunQi 已注册的 `get_platform_info` command、当前
`GatewayConnection` 握手实现和现有 Gateway WebSocket 测试。

## 实施顺序

1. 在 Tauri command wrapper 定义最小平台信息 DTO，并复用严格解析器。
2. 提取纯平台标签解析函数，先处理原生 OS，再处理可选 WebView 提示，未知保持 `unknown`。
3. 让 Gateway 握手异步取得该值，并将同一值用于 `client.platform` 与 `userAgent`；每个
   await 后检查 socket 和 handshake ID 归属。
4. 增加原生优先、失败回退、未知宿主和旧握手失效回归测试；不修改配对、scope、签名或
   重连逻辑。
5. 执行 TypeScript、Rust、文档、构建和差异检查，并记录未完成的目标平台真机验收。

## 不做的事情

- 不把浏览器 UA、当前开发机或任何平台默认值写成 Gateway 身份事实。
- 不新增 OpenClaw RPC、设备字段或配对恢复语义。
- 不声称 macOS、Windows、CentOS、Ubuntu 已完成真实配对验收。
