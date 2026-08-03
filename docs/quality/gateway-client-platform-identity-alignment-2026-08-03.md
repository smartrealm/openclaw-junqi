# Gateway Client 平台身份对齐

日期：2026-08-03

## 结论

JunQi 是 Tauri 桌面客户端，Gateway `connect` 的 `client.platform` 必须来自当前桌面
宿主的原生平台身份。它会参与 OpenClaw 已配对设备的元数据比较；把未知宿主默认写成
`windows` 会把 Linux、其他 WebView 或测试宿主错误归属为 Windows，并可能造成无意义的
设备元数据升级或重新审批。

JunQi 已注册 `get_platform_info` 原生命令，返回 Rust 的 `std::env::consts::OS` 与架构。
握手应优先读取该命令，并仅把 `darwin`、`windows`、`linux` 映射为 Gateway 的常见平台
标签 `macos`、`windows`、`linux`。原生命令不可用或返回未知 OS 时必须发送 `unknown`，
不得猜测为 Windows 或 Linux。

## 权威依据

- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol)
- [OpenClaw connect metadata handling](https://github.com/openclaw/openclaw/blob/main/src/gateway/server/ws-connection/connect-device-metadata.ts)
- [OpenClaw connect hello response](https://github.com/openclaw/openclaw/blob/main/src/gateway/server/ws-connection/connect-hello.ts)

上游的设备元数据处理将 `client.platform` 视为可规范化、可持久化且可能与既有配对记录
比较的字符串。该字段没有将 JunQi 限定为某个浏览器 User-Agent，也没有把未知桌面宿主
定义为 Windows。JunQi 因此必须保留未知语义而非伪造平台身份。

## 审计发现

### GPI-01 - 高 - 未识别宿主被错误标识为 Windows

位置：`src/services/gateway/Connection.ts`

旧的 `detectPlatform()` 仅检查 `navigator.userAgent` 中的 macOS 和 Linux 文本，所有其余
值都返回 `windows`。Gateway 握手随后将该结果用于 `client.platform` 和 `userAgent`。

影响：

- 任何未识别的桌面 WebView 或测试宿主都会向 Gateway 声称自己是 Windows；
- 设备配对的元数据比较可能将真实平台变化误判为身份变化；
- JunQi 已有原生平台信息却未使用，违反桌面客户端不依赖浏览器猜测的边界。

### GPI-02 - 严重 - 失效握手可在异步签名后向新 socket 发送

位置：`src/services/gateway/Connection.ts`

握手在设备 challenge 签名期间异步等待。用户切换 Gateway、连接关闭或重连时，旧 socket
可能已经失效并由新 socket 取代；旧异步流程恢复后仍调用共享的 `send()`，会把旧握手请求
发送到当前 socket。

影响：

- 旧 nonce、凭据快照或握手 ID 可能被发送至新选定的 Gateway；
- 新连接可能收到没有待处理 callback 的旧 `connect` 请求，造成握手状态不确定；
- 平台信息读取新增异步边界后会进一步扩大该既有竞态窗口。

## 目标行为

1. Gateway 握手在发送 `connect` 前读取类型化的 Tauri 平台信息。
2. 平台标签只从原生 OS 值映射；不可识别或读取失败时使用 `unknown`。
3. 非 Tauri 预览环境可用 WebView 信息作次级提示，但不得默认成已知平台。
4. 每个异步握手阶段恢复后必须确认原 socket、握手 ID 和 connecting 状态未变；失效流程
   只能返回，不能发送请求。
5. 握手的其他身份、签名、scope、协议与重连语义保持不变。

## 验证范围

- 单元测试覆盖 macOS、Windows、Linux、未知 WebView 和原生读取失败的映射结果。
- Gateway 握手测试覆盖发送的 `client.platform` 与 `userAgent` 使用同一真实标签。
- 回归测试覆盖连接轮换后旧握手不再发送。
- Tauri command 注册、前端 command 名和返回字段保持一致。
- macOS、Windows、CentOS、Ubuntu 的真实设备配对与重新连接仍需目标系统验收；本次
  仅验证代码与协议边界，不把宿主测试当作真机证据。
