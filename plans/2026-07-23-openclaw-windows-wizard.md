# Windows OpenClaw Wizard 修复计划

## 执行顺序

### Phase A - 恢复协议正确性

| Bug | 文件 | 修复 |
|---|---|---|
| BUG-WIZ-01 | `src/hooks/useSetupFlow.ts`、`src/services/gateway/index.ts` | Wizard RPC 使用 admin requester，同时保留交互请求超时语义。 |
| BUG-WIZ-02 | `src/services/openclawWizard.ts` | 分离 running payload error 与 terminal error，拒绝答案不进入 history。 |

### Phase B - 闭合授权恢复

| Bug | 文件 | 修复 |
|---|---|---|
| BUG-WIZ-03 | `Connection.ts`、`gateway/index.ts`、`useSetupFlow.ts` | 从握手到 Wizard UI 保留结构化授权 issue、requestId 和批准动作。 |

### Phase C - 补齐终态

| Bug | 文件 | 修复 |
|---|---|---|
| BUG-WIZ-04 | `openclawWizard.ts`、`useSetupFlow.ts`、locales | 统一 done/error/cancelled 状态机，并提供明确取消反馈。 |

### Phase D - 回归门禁

| Bug | 测试 | 证明目标 |
|---|---|---|
| BUG-WIZ-01 | `setupOnboardingRegression.test.ts` | Wizard 不得回退到 read/write 日常连接。 |
| BUG-WIZ-02 | `openclawWizard.test.ts` | 被拒答案不进入历史，也不会在 Back/Retry 中重放。 |
| BUG-WIZ-03 | `gatewayCredentialSecurity.test.ts` | Windows 严格授权握手保留 scope-upgrade requestId。 |
| BUG-WIZ-04 | `openclawWizard.test.ts` | cancelled 清理 session 且不要求 next step。 |

## 验证层

- [x] TypeScript 接口与模块边界。
- [x] 删除符号和旧调用点清理检查。
- [x] Wizard、Gateway 授权、Setup 定向行为测试。
- [x] Windows 安装硬化脚本与完整前端测试。
- [x] Rust Gateway lifecycle 库测试。
