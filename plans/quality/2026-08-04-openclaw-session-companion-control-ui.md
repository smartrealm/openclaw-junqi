# OpenClaw 会话 Companion 控制台对齐计划

1. 已审阅最新版 OpenClaw BTW 文档、Control UI 文档、schema、RPC handler、进程内线程服务和官方 Control UI 参考实现。
2. 已审阅 JunQi 聊天发送、Gateway 事件分发、Chat store、Task checkpoint、聊天侧栏、国际化和现有旧 BTW 测试。
3. 已删除旧 `chat.side_result` 路径，新增带连接围栏的 Companion client 与临时侧栏线程。
4. 已新增 RPC 和面板回归测试，并验证删除旧路径不会改变普通发送、事件或会话 store。
5. 已执行完整 lint、test、Rust test、build、官方文档链接检查与 diff 检查；待暂存审阅后提交。
