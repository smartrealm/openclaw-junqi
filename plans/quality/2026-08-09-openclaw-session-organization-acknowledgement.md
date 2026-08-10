# OpenClaw 会话组织写入回执确认实施计划

## 执行顺序

1. 在 `OpenClawSessionOrganizationClient.test.ts` 增加布尔字段缺失与不一致的失败回归。
2. 在 `OpenClawSessionOrganizationClient.ts` 的原生回执边界核验三个布尔字段。
3. 将 `chatStore.ts` 中与实际实现不一致的旧兼容说明改为中文且只描述 Gateway 确认后投影。
4. 运行组织客户端、会话状态仓、侧栏相关回归，随后运行类型检查与差异检查。
