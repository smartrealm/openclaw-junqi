# chat.send leaf 围栏协商实施计划

1. 核对新会话创建、空 transcript、发送协调器与 Gateway 参数链路。
2. 对照 npm stable schema 和 OpenClaw 官方主线 handler、测试确认差异。
3. 在 Gateway 发送边界实现按连接身份隔离的结构化能力协商。
4. 增加 stable 拒绝、连接内复用和禁止其他错误重放的回归。
5. 执行完整测试、构建、打包并在本机 stable Gateway 实测新会话首发。
