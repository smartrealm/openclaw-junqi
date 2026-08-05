# OpenClaw Gateway 挑战与策略对齐规格

## 问题

JunQi 的 operator/UI transport 已收紧到 protocol v4，但仍保留早期 token-only challenge
回退、v2 本机时间签名、宽松 `hello-ok` 接收和固定伪 ping。这些行为与当前 OpenClaw Gateway
正式协议不一致，并会在认证、重连和长时间请求期间产生错误的本地连接状态。

## 约束

- JunQi 仅作为 OpenClaw 客户端，不能新增 RPC 或把服务端兼容分支当成功能承诺。
- 设备签名字段必须从该 socket 的 `connect.challenge` 派生，不能以本机时钟替换服务端时间。
- `hello-ok` 的成功状态只能在必填协议字段完成检查后提交；失败不得写入 credential、身份、
  methods 或启动轮询。
- 日常 scope 继续最小化；审批和临时特权流程保持独立 transient socket。
- 连接 watchdog 不发送未经官方协议定义的 ping；服务端 tick 策略只在成功 handshake 后生效。
- 不能因为本机或某一平台有可用凭据库而假定其他平台具备相同行为。

## 验收条件

- [x] 合法 `connect.challenge` 的 `nonce` 与 `ts` 均进入 Tauri 签名请求，出站
  `device.signedAt` 等于挑战 `ts`。
- [x] 原生签名 payload 与官方 v3 字段顺序一致，使用规范化 platform 和空设备族语义；
  Rust 输入验证不接受无效 nonce、时间或平台。
- [x] 未收到 challenge 不再发送 token-only `connect`；收到缺少 nonce 或无效 `ts` 的
  challenge 时，当前 socket 以握手错误关闭。
- [x] 缺少 `server`、`features`、`snapshot`、`auth` 或有效 `policy` 的 `hello-ok` 不得
  标记连接成功，也不得持久化 token 或发布身份。
- [x] 成功 handshake 后 watchdog 读取 `policy.tickIntervalMs`，不发送伪 ping；长时无界请求
  遇到无活动时关闭 socket，有限 timeout 请求保留自身截止时间。
- [x] 成功 handshake 后的普通和 fenced RPC 在发送前检查 `policy.maxPayload` 与
  `policy.maxBufferedBytes`；拒绝路径必须清理本地 pending callback，不能等待伪超时。
- [x] 日常和 approval transient scope 的既有最小权限测试保持通过。
- [x] TypeScript/Rust 的 command 名称、字段 casing、注册与调用方一致，且回归、静态、构建与
  字符扫描通过。

## 不做的事情

- 不改变 OpenClaw 的配对、token 轮换、scope 授权、服务端 max payload 或附件策略。
- 不新增本地浏览器、agent、会话、工具或 ping 协议来弥补 Gateway 缺失能力。
- 不声明未实测平台已经完成真实 Gateway 验收。
