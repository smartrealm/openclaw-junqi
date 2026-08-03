# OpenClaw Gateway 方法广告发送门禁规格

日期：2026-08-04

## 目标

让 JunQi 的所有 Gateway RPC 通过同一传输层遵守当前 `hello-ok.features.methods`，不向明确未广告的
OpenClaw 方法发送请求。

## 约束

1. 只以当前已验证连接的 `features.methods` 判定；未知广告不可被客户端方法表或版本号替代。
2. 普通请求和 identity-fenced 请求都必须在发送前拒绝明确缺失的方法。
3. 拒绝不创建 callback、不分配 request id、不发送 WebSocket 数据，也不表示 Gateway 已执行或拒绝该操作。
4. 断线与 identity 围栏错误保持其已有优先级和类型；广告未知保持当前可重试传输语义。
5. 不改变 OpenClaw RPC 参数、返回值、scope、事件处理或平台专属行为。

## 验收条件

- [x] 已广告方法继续按现有请求路径发送。
- [x] `request` 对明确未广告的方法在本地失败且零 WebSocket 写入。
- [x] `requestFenced` 对明确未广告的方法在本地失败且零 WebSocket 写入。
- [x] 未完成握手或广告未知时不以本地清单猜测方法不可用。
- [x] 回归测试、TypeScript、边界、全量测试、构建和官方文档检查通过。
