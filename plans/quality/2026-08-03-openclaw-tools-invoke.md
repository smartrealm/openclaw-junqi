# OpenClaw tools.invoke 受控调用实施计划

## 实施项

- [x] 核对本机 OpenClaw `tools.invoke` 参数、权限和结果 schema。
- [x] 增加严格的参数构造与结果解析服务。
- [x] 通过日常 `operator.write` 连接暴露 Gateway 调用方法。
- [x] 在 Chat effective tools 面板增加会话绑定、JSON 参数、确认和临时结果展示。
- [x] 增加服务回归测试和三语言文案。
- [ ] 真实 Gateway 工具、审批、owner-only wrapper 和 MCP 工具手工验收。

## 验证顺序

1. `toolsInvoke` 服务测试和 TypeScript 类型检查。
2. Chat composer contract、lint、前端完整测试和生产构建。
3. 记录真实工具调用和目标平台未验证边界，不把自动化结果描述为真实执行。
