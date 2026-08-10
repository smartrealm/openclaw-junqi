# 项目交接状态

更新时间：2026-08-11

## 当前目标

以最新版 OpenClaw 官方 Gateway 协议和源码为依据，完成 Gateway 原生能力与 JunQi 扩展能力的一致性审计。本阶段已将 `Blues-Code/Jarvis` 的文档清理提交通过独立合并提交纳入 `main`，并完成审计中确认的协议收敛和遗弃链路清理。

## 已完成内容

- 已发布本地主版本 `v3.0.0`；`main`、`daxia`、`Blues-Code/code`、`Blues-Code/dingtalk` 与 `Blues-Code/Jarvis` 已对齐到同一发布提交。
- `main` 先从 `442fe97c` 快进到 `dfe9d22e`，纳入 Jarvis 分支的八个提交；随后通过合并提交 `b6f930ab` 纳入 Jarvis 的 `44131f98` 文档与历史记录清理。
- 保留 Jarvis 的会话目标解析、Cron 声明键、Gateway 生命周期和钉钉业务改动。
- 删除最新版 OpenClaw 已移除的 `sessions.compaction.get`、`talk.session.cancelTurn`、`voicewake.routing.set` 和 REM 诊断调用路径。
- 会话历史与协作能力不再把 `hello-ok.features.methods` 当成完整方法清单；身份和权限核验完成后按官方请求契约调用，并以结构化响应判断结果。
- Cron 输入和投影按官方日期上限校验，删除上游 schema 已移除的调度状态字段，并保留官方全局与任务级运行记录信封。
- 审计活动解析已拆分为独立编解码边界，移除不存在的 `audit.list` 兼容路径。
- 相关审计、规格和实施计划已记录到 `docs/quality`、`specs/quality` 与 `plans/quality`。
- 删除无桌面消费者的三项 `junqi.collab.session.mutation*` 扩展、专属状态机与 schema 14 数据表；协作插件 schema 升至 15，旧 schema 14 数据库按当前结构校验失败关闭，不做自动迁移或删除。
- 删除无生产入口的 Workbench Provider claim 前端状态、IPC、Rust command 与 PTY 清理双轨；保留只读的 provider 二进制可用性探测和既有 PTY 生命周期。

## 关键技术决策

- OpenClaw 是会话、任务、工具、配置和运行时状态的唯一权威，JunQi 只维护可追溯的桌面投影。
- `hello-ok.features.methods` 仅作为保守发现信息，不能据此隐藏或拒绝官方方法。
- Jarvis 引入的 `resolveOpenClawSessionTarget` 继续用于分支和恢复操作，但已从官方协议移除的检查点读取方法不保留。
- Native 与 Docker 的运行时身份、配置、凭据和恢复路径必须独立绑定，不允许静默切换。

## 核心文件

- `src/services/gateway/SessionCompactionClient.ts`
- `src/services/gateway/sessionCapabilities.ts`
- `src/services/gateway/cronContract.ts`
- `src/services/gateway/cronRuns.ts`
- `src/services/gateway/OpenClawAuditClient.ts`
- `src/services/gateway/OpenClawAuditActivityCodec.ts`
- `src/stores/collaborationSetupStore.ts`
- `packages/junqi-collab/src/schema.ts`
- `packages/junqi-collab/src/service.ts`
- `src-tauri/src/commands/workbench_provider.rs`
- `src-tauri/src/commands/workbench_pty.rs`
- `docs/quality/gateway-native-extension-consistency-audit-2026-08-10.md`
- `specs/quality/2026-08-10-gateway-audit-protocol-convergence.md`
- `plans/quality/2026-08-10-gateway-audit-protocol-convergence.md`

## 测试与验证

- Jarvis 合并后 Gateway、Cron、会话能力、语音、审计和协作状态定向回归共 78 项通过。
- 清理 Jarvis 带回的旧检查点读取测试后，会话检查点与 Cron 定向回归 28 项通过。
- Jarvis 合并后 `pnpm lint` 通过，模块边界扫描 921 个文件无违规，发布版本一致性与 TypeScript 检查通过。
- Jarvis 合并后 `git diff --check` 通过；76 个修改或新增文本文件的完整内容未检出 Emoji。
- 最新 Jarvis 合并提交的父提交关系与祖先关系已核对；合并前未提交工作区在恢复后完成逐文件内容比较，没有遗失或未解决冲突。
- 合并前已通过 Tauri command 注册契约测试、`pnpm collab:validate` 和 `pnpm dingtalk:validate`。
- 本轮完整 `pnpm test` 通过：2,759 个前端测试与 236 个脚本测试均无失败。
- `pnpm lint`、`pnpm collab:validate`、`pnpm build`、`cargo fmt -- --check`、`cargo check --lib` 和 `cargo test --lib` 均通过；Rust 库测试 683 项通过，2 项按既有标记忽略。
- `git diff --check` 已通过。仍未执行 Tauri 安装包构建或三平台真机验收。

## 已知问题与未验证边界

- 真实 Gateway 对移除方法、会话恢复、Cron 全局分页和协作插件能力的运行回执仍待验证。
- macOS、Windows 和 Linux 的凭据库、WebView、窗口生命周期及真实 UI 尚未完成本轮真机验收。
- 合并前工作区包含用户要求的审计和视觉收敛改动，必须保持其未提交状态，不得与本次分支合并自动提交。

## 失败方案

- 仅根据 `hello-ok.features.methods` 缺项判定官方能力不可用，已删除。
- 为上游已移除 RPC 保留兼容调用或本地替代路径，已删除。
- 接受 Cron 旧字段、越界时间戳或猜测性状态，已删除。

## 下一步顺序

1. 在受控真实 Gateway 验证会话恢复、Cron 分页、协作插件加载与请求回执。
2. 在 macOS、Windows 与 Linux 真机验证凭据库、WebView 和进程生命周期。
3. 仅在上述原生证据存在时继续扩展 JunQi 桌面投影，不为缺失能力构造本地语义。
