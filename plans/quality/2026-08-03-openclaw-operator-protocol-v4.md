# OpenClaw Operator Protocol v4 对齐计划

日期：2026-08-03

## 实施顺序

1. [x] 在 `Connection.ts` 定义 operator/UI 的官方 protocol v4 常量，并将 connect
   请求收紧为精确 v4 范围。
2. [x] 在 `hello-ok` 状态提交之前校验响应 protocol；不匹配时走既有握手失败关闭路径。
3. [x] 在 WebSocket 回归测试中验证出站范围、v3 拒绝与 v4 正常连接。
4. [x] 更新受影响的 operator runtime-identity 测试夹具为 v4；不修改 node/probe 代码。
5. [x] 执行 TypeScript、定向测试、完整测试、构建、官方文档验证、格式和字符扫描。

## 文件范围

- `src/services/gateway/Connection.ts`
- `src/services/gateway/gatewayCredentialSecurity.test.ts`
- `src/services/gateway/GatewayCredentialBinding.test.ts`
- `src/components/Chat/CollaborationChatProvider.test.ts`
- 对应 docs、specs、plans 索引与本记录
