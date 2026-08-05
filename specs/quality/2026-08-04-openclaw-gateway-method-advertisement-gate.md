# OpenClaw Gateway 方法广告发现边界规格

日期：2026-08-04

## 目标

保证 JunQi 将 `hello-ok.features.methods` 用作可选功能发现，而不是对 Gateway RPC 的本地
发送许可表。

## 约束

1. 不以安装版本、客户端常量表、方法名称前缀或 UI 状态推断 RPC 不可调用。
2. `request` 与 `requestFenced` 不得因方法未出现在广告数组中拒绝已连接 Gateway 的请求。
3. 连接状态、identity fence、请求超时和 WebSocket 帧协议继续在传输层执行。
4. 方法参数、方法注册、插件状态和 scope 授权必须由当前 Gateway 正式响应裁决。
5. 不改变 OpenClaw RPC 参数、返回值、队列语义或平台专属行为。

## 验收条件

- [x] 移除无调用方的广告缓存与公开 API，避免其再次被误用为许可表。
- [x] 普通 `request` 在广告缺失时仍发送到已连接 Gateway。
- [x] `requestFenced` 在广告缺失且 identity 一致时仍发送到已连接 Gateway。
- [x] 断线与 identity 围栏的错误优先级不变。
- [x] 回归测试、TypeScript、边界、全量测试、构建和官方文档检查通过。
