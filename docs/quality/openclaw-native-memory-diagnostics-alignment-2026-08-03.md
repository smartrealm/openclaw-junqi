# OpenClaw 原生记忆诊断对齐

日期：2026-08-03

状态：历史记录。OpenClaw 主线已在 2026-08-10 删除 `doctor.memory.remHarness`；JunQi 已同步移除该请求、界面和状态。
当前契约与整改结果以 [`Gateway 原生能力与扩展一致性审计`](gateway-native-extension-consistency-audit-2026-08-10.md) 为准。

## 依据

本次实现以 OpenClaw 当前官方文档、方法目录、权限表和 Gateway handler 为契约。安装包
只用于本地复现，不作为能力开关、版本分支或默认行为来源。

- [`gateway/protocol.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
  将 `doctor.memory.status` 定义为向远程客户端返回向量记忆/缓存 embedding 就绪状态，
  并说明 `doctor.memory.remHarness` 是有界、只读的 REM harness 预览。前者只有在调用方
  明确传入 `probe` 或 `deep` 时才探测 embedding provider。
- [`core-descriptors.ts`](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)
  将两个方法列为 `operator.read`，并纳入 Gateway 能力目录。
- [`method-scopes.ts`](https://github.com/openclaw/openclaw/blob/main/src/gateway/method-scopes.ts)
  维护 operator scope 解析；JunQi 不新增 scope，也不把诊断调用提升为管理员操作。
- [`server-methods/doctor.ts`](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/doctor.ts)
  定义了 status 的可选 `agentId`、`probe`、`deep` 参数和 embedding/runtime 字段，以及
  remHarness 的 `grounded`、`includePromoted`、`limit` 参数、成功/错误返回联合结构。

## 当前行为

1. Memory Explorer 增加独立的 Gateway diagnostics 视图。工作区 Markdown 浏览和
   `memory.search` 检索保持原有独立边界，不合成诊断结果。
2. 用户点击“检查状态”时，JunQi 通过日常 Gateway `operator.read` 连接调用
   `doctor.memory.status`，默认发送 `{}`；不自动发送 `probe` 或 `deep`，不主动触发外部
   embedding provider。响应中的 `agentId`、provider、embedding readiness、缓存字段和
   官方 llama.cpp runtime 字段按原值展示。
3. 用户点击“预览 REM harness”时才调用 `doctor.memory.remHarness`。grounded 文件和
   promoted 候选只有在用户显式勾选后才请求；候选、路径、渲染 Markdown、配置和 Gateway
   返回的 `ok: false` 错误均保持 native 语义。JunQi 不创建本地 REM 记录，也不把预览写回
   工作区或会话。
4. 方法是否列入 Gateway 发现列表不决定是否发送 RPC；按协议真实尝试，并由 Gateway 返回
   method-not-found、权限、传输或 malformed response 时，store 保留明确错误状态，不降级
   成空结果或伪造“不可用”以外的诊断结论。
5. 诊断请求绑定当前 Gateway 连接和最新请求栅栏。断线、连接替换或旧响应到达时，旧结果
   不能覆盖当前连接；诊断快照只存在内存 store，不写入 localStorage、日志或文件。

## 验证结果

- `OpenClawMemoryDiagnosticsClient.test.ts` 覆盖官方请求参数、默认不探测、embedding/runtime
  字段、REM 成功/错误联合响应、内容保真、上限和 malformed response。
- `gatewayDataStore.test.ts` 覆盖能力广告、独立 status/remHarness 调用、未知能力、断线和
  迟到结果栅栏。
- `MemoryExplorerPage.test.ts` 保留桌面页面边界：页面只消费 workspace hook 和共享
  Gateway store，不调用浏览器 fetch 或历史 `window.aegis` memory API。
- 提交前运行定向测试、TypeScript、lint、完整测试、生产构建、官方链接校验、差异检查和
  Emoji 扫描。

## 未验证边界

- 尚未连接真实 Gateway 现场验证不同 memory plugin、缓存过期、provider 探测失败、llama.cpp
  runtime 字段和 REM harness 的实际内容组合。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机验证权限拒绝、远程 Gateway、长路径和大量
  grounded 文件的视觉表现；UI 仍以官方有界返回为前提。
- `doctor.memory.*` 的 backfill、reset、repair、dedupe 等写入/修复方法、任何本地 CRUD、
  自动探测和事件订阅不在本次范围内。
