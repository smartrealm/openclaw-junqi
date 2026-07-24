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
| BUG-WFR-07 | `setup.rs` | 输出静默不再终止仍运行的 npm，只保留绝对期限和明确取消。 |
| BUG-WFR-08 | `setup.rs` | 心跳与网络统计共享固定 `logSlot`，HTTP 明细仅写进程日志。 |
| BUG-WFR-09 | `setup.rs` | 使用 `--prefer-offline` 复用热缓存，缺失内容仍走已选镜像。 |

## Phase C2 - 健康探测稳定性

| Bug | 文件 | 修复 |
|---|---|---|
| BUG-WFR-10 | `system.rs`, `paths.rs` | 冒烟测试加重试；已验证 payload 缓存跳过重复冒烟，避免瞬时失败触发非预期重装。 |
| BUG-WFR-11 | `system.rs` | 已选定 Node/npm 探测加重试，避免冷启动瞬时失败级联触发 Node 重装或阻断安装。 |

## Phase D - 验证

- [x] Gateway 配对继续、取消和单次 RPC 行为测试。
- [x] Setup Wizard 重连与错误动作回归测试。
- [x] Rust 服务预算、恢复分类及 npm 输出测试。
- [x] 前端定向测试、完整测试、TypeScript 构建和 Rust 测试。
- [x] 静默 npm 不误杀、绝对期限不延长的行为测试。
- [x] npm 固定活动行与 HTTP 明细隔离测试。
- [x] npm 热缓存优先且不进入严格离线模式的参数测试。
- [x] 已验证 payload 签名稳定性/变更失效测试；全量 Rust 测试零回归。
- [x] Node/npm 探测重试后全量 Rust 测试零回归（605 passed）。
