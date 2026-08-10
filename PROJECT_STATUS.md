# 项目交接状态

更新时间：2026-08-10

## 当前目标

持续将 JunQi 收敛为 OpenClaw 的跨平台桌面客户端：以官方 Gateway 协议、官方源码和结构化回执为唯一行为依据，完成安装、会话发送与生命周期、模型认证、配置写入及 Cron 的全链审查。混合改动必须先按主题完成核验；仅在用户明确要求后暂存和提交。

## 已完成内容

- 已提交 `8d9db3e1`：普通 `sessions.delete` 与 `sessions.reset` 不再经过 JunQi 协作插件的本地围栏，直接等待 OpenClaw 的结构化回执；相关本地包装、对话框和专属测试已删除。
- 普通聊天已删除 `src/task-execution/` 本地任务图、检查点、工具恢复和恢复横幅。发送、转向、Stop 与工具流只投影 OpenClaw 的 `chat.send`、会话事件、transcript 和原生 Task Ledger，不再生成本地 Task、Run、Node、Edge 或伪 Tool Result。
- 新建会话仍以 Gateway `sessions.create` 回执为准。确认前不加载旧会话历史，确认后的空 transcript 保持空 leaf；失败保留原始新建意图。
- 安装完成不再追加模型实时验证。`openclaw.setup.detect.setupComplete` 明确可用时作为配置判据；该方法明确不受支持时，进入同一 Gateway 的官方 `wizard.start`，不以本地配置、模型字段或完成标记推断已完成。连接和畸形协议错误仍失败关闭。
- 官方 Wizard 恢复使用无答案的 `wizard.next`，不使用会清理会话的 `wizard.status`。
- Provider 认证状态、探测和注销均携带 Gateway 已确认的 `agentId`；会话模型目录与默认模型目录分离，缺少会话智能体目录时不回退复用默认智能体能力。
- 配置写入使用 `config.get` 的 `hash` 作为 `config.patch.baseHash`，成功回执必须显式确认；不再以完整 `config.set` 或本地乐观状态替代 Gateway 确认。
- Cron 运行记录按官方 `cron.runs` 的 `scope`、筛选和分页信封读取；最近运行记录使用官方全局范围，不按本地任务数量截断。
- Cron 任务列表已改为按官方 `cron.list` 分页读取，所有页面必须具有同一 `snapshotRevision`，且只有全部页面成功才更新界面。旧数组响应、偏移错误、页元数据错误和快照变化均失败关闭。
- Cron 创建对一次未确认的提交保留官方 `declarationKey`，Gateway 未确认前不自动重放未知写入。

## 关键技术决策

- OpenClaw 是 Agent、会话、工具、transcript、任务账本、配置和运行时状态的唯一权威。JunQi 只保存绑定当前运行时、Gateway 和会话身份的界面派生状态。
- Gateway 可达不等于认证、配置完成、模型可用或服务归属正确；各结论只能由对应官方调用或结构化事件给出。
- 旧 Gateway 缺少最新版检测方法不等于配置已完成，也不等于安装失败。客户端将控制权交给同一 Gateway 的官方 Wizard，而非使用本地 fallback。
- Stop 仅请求官方中止当前 run；不会清空会话，不会伪造 Tool Result，也不会将本地快照写入 OpenClaw transcript。
- 有副作用操作遇到超时或断线时保持待核验，不由桌面端自动重放；官方声明键或其他上游幂等机制仅在协议明确支持时使用。

## 修改过的核心文件

- `src/services/chat/sendTransaction.ts`、`src/runtime/OpenClawChatEventRuntime.ts`、`src/task-execution/`：删除普通聊天的本地任务执行语义。
- `src/services/setup/setupCompletionGate.ts`、`src/hooks/useSetupFlow/index.ts`、`src/services/openclawWizard.ts`：安装完成判定和官方 Wizard 恢复。
- `src/services/gateway/OpenClawCronListClient.ts`、`src/stores/gatewayDataStore.ts`：Cron 列表分页、快照一致性和失败关闭。
- `src/services/gateway/cronRuns.ts`、`src/services/gateway/OpenClawCronRunClient.ts`、`src/pages/CronMonitor.tsx`：Cron 运行记录官方分页读取。
- `src/services/gateway/OpenClawModelAuthStatusClient.ts`、`src/services/gateway/OpenClawModelProbeClient.ts`、`src/services/gateway/OpenClawModelAuthLogoutClient.ts`、`src/pages/ConfigManager/ProvidersTab.tsx`：智能体作用域的模型认证操作。
- `src/services/gateway/OpenClawRuntimeConfigClient.ts`、`src/services/gateway/OpenClawConfigPatch.ts`、`src/services/channelConfig.ts`、`src/pages/ConfigManager/`：官方 `config.patch` 最小写入。
- `docs/quality/openclaw-chat-task-boundary-audit-2026-08-10.md`、`docs/quality/openclaw-installation-completion-contract-audit-2026-08-09.md`、`docs/quality/openclaw-cron-list-pagination-audit-2026-08-10.md` 及相应 `specs/`、`plans/`：审计依据、行为规格和实施记录。
- `docs/previews/junqi-first-run-flow.html`：首次启动流程预览已同步当前安装判定；线上预览未部署验证。

## 测试与验证结果

- `pnpm exec tsc --noEmit`：通过。
- `pnpm lint`：通过，模块边界检查和版本一致性检查均通过。
- `pnpm build`：通过，协作插件与钉钉插件契约校验、TypeScript 和 Vite 生产构建均通过。
- 会话发送、聊天事件投影和会话生命周期定向回归：84 项通过。
- 安装完成门禁、官方 Wizard 与 Setup 客户端定向回归：55 项通过。
- Cron 列表、Cron 运行记录、Cron 创建和 Gateway 数据层定向回归：57 项通过。
- `git diff --check`：通过。
- `pnpm test`：通过，命令退出成功；输出包含既有 Node 弃用与 Radix SSR 警告，无测试失败。
- 本阶段尚未在最新工作区执行 Rust 检查或 Tauri 安装包验证。
- macOS、Windows、Ubuntu、CentOS 的 Gateway、官方 Wizard、系统凭据和安装器真实验收尚未执行，不能描述为已验证。

## 已知问题

- 旧 Gateway 对 `openclaw.setup.detect` 的实际 Wizard 展示、跳过选项和完成终态尚未用真实桌面窗口验证。
- 真实多智能体 Gateway 的私有模型认证、Cron 多页数据和 Tauri 视觉交互尚未验收。

## 尝试过但失败的方案

- 将 `openclaw.setup.detect` 的“方法不支持”当作“无需配置”会错误跳过官方 Wizard，已删除该分支。
- Cron 列表曾只读取一页并接受旧数组形状，既会漏任务也无法证明分页完整性，已删除。
- 普通聊天曾维护本地任务图和 Tool 恢复状态，超出 OpenClaw 客户端边界，已删除。

## 下一步开发顺序

1. 对剩余混合工作区改动按会话、安装、模型配置、Cron 和文档分组复审，确认每个文件的官方依据和真实消费者。
2. 执行全局无引用搜索，清理已删除本地任务图对应的历史规格、计划、测试、文案和索引残留；保留原生 Task Ledger 与 compaction checkpoint 的官方读取。
3. 对每个独立批次执行定向测试、`pnpm lint`、完整前端测试、构建及差异检查，并补齐真实失败的回归测试。
4. 在不污染现有用户环境的前提下，以 Tauri 安装包验证官方 Wizard、空新会话首发、模型智能体切换和 Cron 多页读取；Windows、Linux 结果必须单独记录。
5. 后续新改动仅在工作区无混杂改动、文档和验证一致且用户明确要求后，按独立主题暂存和提交中文提交信息。
