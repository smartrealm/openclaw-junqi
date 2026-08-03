# OpenClaw Talk 事件契约计划

1. [x] 核对 OpenClaw 官方 Gateway 协议、当前 schema 和 Talk handler 的事件 envelope。
2. [x] 审查 JunQi 事件桥接、Talk 协调器、调用方和已有测试，确认无效事件可影响桌面状态机。
3. [x] 收紧必要的序号、时间戳、turn/capture 关联字段，不扩展 OpenClaw 事件语义。
4. [x] 增加有效与无效 envelope 的回归测试。
5. [x] 执行全局清理扫描、与本地 main 重新核对、最终差异验证并中文提交；分层自动化验证已通过。
