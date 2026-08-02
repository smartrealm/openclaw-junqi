# ReAct 任务检查点与恢复实施计划

日期：2026-08-02

## 实施顺序

1. 定义独立的 Task、Task Run、Node、Edge、Checkpoint 与恢复核验领域模型，并为状态转换写纯函数测试。已完成 Run、Node、最小 Edge、checkpoint revision、冲突合并、session identity 轮换和 steer 竞态隔离。资源锁没有上游 Chat/Tool 契约支撑，未在客户端虚构；Edge 只记录本地意图与 OpenClaw 事件顺序，不推断上游未提供的依赖。
2. 在 Tauri Rust 层增加运行时身份绑定的持久存储和 typed IPC；不把 checkpoint 放入前端持久存储，也不存储密钥、音频或伪造工具结果。已复用经过验证的 `workbench_session` 原子持久化 IPC；专用 Task 命令待评估。
3. 扩展 Gateway adapter，暴露严格解码后的 native `sessions.abort` acknowledgement、history reconciliation、Run 引用和原生 `tasks.*` ledger；保持 OpenClaw 为 transcript 与工具协议权威。native abort、终态、工具 lifecycle、history 核验 checkpoint、task ledger adapter、官方 `sessions.steer` 语音抢话和只读恢复提示已接入。
4. 将普通 Chat、Quick Chat 和 Jarvis 的发送、Stop、队列排空、连接核验和模型身份记录统一接入 TaskExecution coordinator。普通发送、Stop、队列排空和 Jarvis steer 已接入；Gateway transport 的本地 `AbortSignal` 与 native `sessions.abort` 已接入；真实重连和模型切换的目标平台验收仍待执行。
5. 把工具投影扩展为 cancelled、rolled_back、verification_required，并在权威 history 读回后结算，不根据 UI 事件推断完成。`verification_required`、`cancelled`、reconciliation node、history 核验 checkpoint 和只读核验入口已接入；`rolled_back` 只有得到 OpenClaw 权威证据时才允许，当前未虚构该证据。
6. 为副作用工具增加策略接口：稳定幂等键、可查询核验、人工介入三种模式；默认阻止自动重试。当前仅记录 JunQi 本地 effect key 和 manual reconciliation 状态，未把它冒充为 OpenClaw 工具幂等键；官方工具副作用元数据和核验 RPC 尚未提供证据，因此自动重试、自动补偿和自动标记完成仍禁止。
7. 将协作插件现有的 revision、command lease、UNKNOWN、取消和依赖解锁模式抽取为可复用原则，不将 Workflow Run 或只读 Graph Projection 作为普通 Chat 的状态源。
8. 建立可观测指标和回归场景：打断、半截 tool call、AbortSignal 竞态、冷启动、session identity 轮换、队列排空、并发独立节点和副作用工具。自动化场景已覆盖前六项的本地状态机边界；真实 Gateway、模型切换和副作用工具仍需外部验收。
9. 完成 TypeScript、Rust、插件契约、真实 Gateway 及 macOS/Windows/CentOS/Ubuntu 桌面验收。自动化验证已完成；真实 Gateway、副作用工具、麦克风、后台常驻、签名与发布验收仍未执行。

## 预计文件范围

- `src/task-execution/`
- `src/services/gateway/`
- `src/runtime/JarvisVoiceRuntime.tsx`
- `src/components/Chat/message-input/`
- `src/pages/QuickChatPage.tsx`
- `src/processing/toolExecutionProjection.ts`
- `src/components/Chat/ToolCallBubble.tsx`
- `src-tauri/src/commands/`
- `src-tauri/src/lib.rs`
- `src/api/tauri-adapter.ts`
- `src/locales/{zh,zh-TW,en}.json`
- 对应 TypeScript、Rust 与集成测试

## 验证

```bash
pnpm lint
pnpm test
pnpm test:rust
pnpm build
pnpm collab:test
pnpm collab:validate
git diff --check
```

真实验收必须额外覆盖选定 Gateway runtime、真实副作用工具、Windows、CentOS、Ubuntu 的原生麦克风和后台运行。不得把本机自动化结果描述为目标平台验收。
