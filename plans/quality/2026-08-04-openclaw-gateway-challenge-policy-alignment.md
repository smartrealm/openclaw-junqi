# OpenClaw Gateway 挑战与策略对齐计划

## 实施顺序

1. [x] 核对 OpenClaw protocol schema、正式 gateway client、设备验证 handler 与 JunQi
   TypeScript/Rust/IPC/调用方链路。
2. [x] 记录 challenge 时间、token-only fallback、`hello-ok` 与伪 ping 的协议偏差；确认审批
   transient socket 是既有最小权限设计。
3. [x] 扩展设备签名 DTO，按官方 v3 payload 使用 challenge `ts`、platform 和 device family。
4. [x] 移除 token-only fallback，校验 challenge 与 `hello-ok` 必填字段，并以 policy 驱动
   活动 watchdog。
5. [x] 为 TypeScript WebSocket 行为和 Rust payload/验证补充会在修改前失败的回归测试。
6. [x] 运行定向、全量、构建、格式、边界、官方文档和 Emoji 扫描，记录真实平台未验证项并提交。

## 文件范围

- `src/services/gateway/Connection.ts`
- `src/services/gateway/gatewayCredentialSecurity.test.ts`
- `src/services/gateway/Connection.queue.test.ts`
- `src/api/tauri-commands.ts`
- `src-tauri/src/commands/device_identity.rs`
- 对应 docs、specs、plans 索引与本记录

## 保护条件

- 不依赖未定义的 `ping` RPC，不扩大日常 operator scope。
- 只以官方 challenge、schema 和 hello policy 驱动连接状态；不以本地时间、测试夹具或平台假设
  合成成功。
- 旧 v2 验证仅是 Gateway 服务端兼容信息，修复后不保留 JunQi v2 签名生成路径。
