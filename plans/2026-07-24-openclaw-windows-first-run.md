# Windows 首次安装修复计划

## Phase A - 授权与向导连续性

| Bug | 文件 | 修复 |
|---|---|---|
| BUG-WFR-01 | `src/services/gateway/index.ts`、`src/App.tsx` | admin transient 配对重试、成功通知和显式取消。 |
| BUG-WFR-02 | `src/hooks/useSetupFlow.ts` | next/back 发送前等待已验证连接。 |
| BUG-WFR-03 | `src/pages/SetupPage.tsx` | 错误前置，错误状态主动作改为 Retry。 |

## Phase B - Windows 服务恢复

| Bug | 文件 | 修复 |
|---|---|---|
| BUG-WFR-04 | `gateway_service.rs` | Windows 使用 60 秒受控命令预算。 |
| BUG-WFR-05 | `gateway_diagnostics.rs` | 已确认清理的状态检查超时分类为 Retry。 |

## Phase C - npm 可观测性

| Bug | 文件 | 修复 |
|---|---|---|
| BUG-WFR-06 | `setup.rs` | 真实阶段里程碑、网络请求聚合、原始日志保留。 |

## Phase D - 验证

- [x] Gateway 配对继续、取消和单次 RPC 行为测试。
- [x] Setup Wizard 重连与错误动作回归测试。
- [x] Rust 服务预算、恢复分类及 npm 输出测试。
- [x] 前端定向测试、完整测试、TypeScript 构建和 Rust 测试。
