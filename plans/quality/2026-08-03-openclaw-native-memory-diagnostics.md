# OpenClaw 原生记忆诊断实施计划

状态：历史计划。OpenClaw 主线已删除 `doctor.memory.remHarness`，当前移除计划见
[`2026-08-10 Gateway 审计协议收敛`](2026-08-10-gateway-audit-protocol-convergence.md)。

## 实施顺序

1. 查阅 OpenClaw 当前官方 protocol、descriptor、scope 和 doctor handler，确认参数、权限
   和 status/remHarness 返回联合结构。
2. 新增严格 `OpenClawMemoryDiagnosticsClient`，保留 status 的显式探测参数和 REM 的有界
   参数，不写入本地状态源。
3. 在 `gatewayDataStore` 增加连接绑定、能力广告、最新请求栅栏、断线清理和明确错误状态。
4. 在 Memory Explorer 增加独立 diagnostics 视图；status 手动触发，REM 预览及 grounded/
   promoted 选择由用户显式触发。
5. 补充协议、store、页面边界测试和三语文案，更新 docs/specs/plans 索引及全局拓展计划。
6. 执行定向测试、TypeScript、lint、完整测试、构建、官方链接校验、diff 检查和 Emoji 扫描，
   使用中文 commit。

## 文件范围

- `src/services/gateway/OpenClawMemoryDiagnosticsClient.ts`
- `src/services/gateway/OpenClawMemoryDiagnosticsClient.test.ts`
- `src/stores/gatewayDataStore.ts`
- `src/stores/gatewayDataStore.test.ts`
- `src/pages/memory-explorer/MemoryExplorerPage.tsx`
- `src/pages/memory-explorer/MemoryExplorerPage.test.ts`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 `docs/`、`specs/`、`plans/` 索引和全局能力拓展计划

## 验证与边界

自动化测试只能证明客户端协议解码、权限出口、状态栅栏和页面边界。真实 Gateway 的
memory plugin/provider 组合、权限拒绝、远程连接、provider 探测、REM 内容和 macOS、
Windows、CentOS、Ubuntu 真机行为仍需单独验收；未取得官方写入契约前保持只读，不实现
猜测性兼容。
