# OpenClaw Gateway 方法广告发送门禁计划

日期：2026-08-04

1. [x] 核对官方 Gateway client guide、protocol、method registry 和当前安装运行时的 hello schema。
2. [x] 审查 JunQi 专用 client 与直连 `GatewayConnection` 调用图，确认缺口位于通用 request 边界。
3. [x] 在普通和 identity-fenced request 路径加入当前连接的明确方法广告门禁。
4. [x] 增加未广告方法不发送的回归测试，同时保留广告未知和既有围栏语义。
5. [x] 更新验证结果，执行全量检查、main 对齐和中文提交。
