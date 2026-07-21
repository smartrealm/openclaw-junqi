# OpenClaw Agent 协作运行设计

> 状态：**Portable Core、Desktop 闭环和 Chat UI 已实现；真实 Gateway 发布验收中**
>
> 审查基线：当前工作树；OpenClaw `2026.7.1`；2026-07-20
>
> 范围：JunQi 在 Chat 内编排当前 OpenClaw Gateway 中已经配置并获授权的 Agent。
>
> 发布规则：第 10 节中标记为“真实 Gateway 待验收”的门槛全部通过前，不得发布为生产可用。自动化通过只证明实现和契约，不代替真实 System Service、Docker 或 External Gateway 验收。

---

## 0. 结论与边界

### 0.1 产品结论

JunQi 的核心能力不是独立的流程画布，而是附着在一条原生 OpenClaw Chat Session 上的**协作运行**。

一次协作运行从一条已持久化的用户消息发起，经过预检、规划、计划确认、Agent 分派、证据验收、结果汇总、原 transcript 交付和归档后结束。图谱只是服务端状态的可视化投影，不是运行事实来源。

### 0.2 V1 可承诺的闭环

V1 只在以下条件全部满足时允许启动协作：

1. 当前连接的 Gateway 实例身份已经确认。
2. Gateway 具有不依赖 JunQi Desktop 进程的持续运行能力。
3. Collaboration Plugin 已安装、启用、健康，版本和 schema 兼容。
4. 发起消息已经取得原生 `sessionId`、transcript `messageId` 和稳定客户端幂等标识。
5. 协调 Agent 和候选 Worker 已配置且处于插件显式授权范围内。
6. 原 transcript 身份写入 API、Subagent 执行 API、Task 查询/取消 API 已通过阶段 0 实测。

满足这些条件后，系统承诺：

- JunQi 窗口关闭不影响运行推进。
- Gateway 或插件重启后可以恢复，不重复分派已开始的 Attempt。
- 每一个状态、用户决定、外部执行和恢复动作都可追溯。
- 最终结论要么已确认写入指定的原 transcript，要么明确停在 `DELIVERY_PENDING`。
- 不会因为 `sessionKey` 被 reset/reuse 而把结果写入另一条会话实例。

### 0.3 最终架构

```text
JunQi Desktop
  |
  +-- ChatTimeline sidecar + CollaborationStore
  |       |
  |       +-- junqi.collab.* Gateway RPC
  |       +-- snapshot + event cursor replay
  |
  +-- Tauri Collaboration Bootstrap Supervisor
          |
          +-- identify active Gateway runtime
          +-- install / enable / update / rollback plugin
          +-- durable Gateway prerequisite
          +-- storage migration / OpenClaw update maintenance gate

OpenClaw Gateway
  |
  +-- JunQi Collaboration Plugin
          |
          +-- collaboration.sqlite (domain authority)
          +-- command outbox / reconcile / audit events
          +-- public openclaw/plugin-sdk entry points only
                 +-- runtime.tasks.managedFlows
                 |      (one run-level mirror/cancellation fence only)
                 +-- Native: runtime.subagent.run/waitForRun/getSessionMessages
                 |      +-- OpenClaw-owned subagent Task
                 |      +-- no managedFlows.runTask double dispatch
                 +-- ACP: gateway.request("tools.invoke", sessions_spawn)
                 |      +-- runtime="acp", official ACP policy/backend path
                 |      +-- runtime.tasks.runs / agent.wait / transcript APIs
                 +-- runtime.tasks.runs
                 |      (lookup and real Task cancellation)
                 +-- session-transcript-runtime
                        (identity/read/exact append by
                         agentId, sessionKey, sessionId, idempotencyKey)
```

这条链路也是执行边界：JunQi 只通过 `junqi.collab.*` 调用当前 Gateway 中的 Collaboration Plugin，插件只通过 OpenClaw 公共 Plugin SDK 操作 OpenClaw Agent、Task/Flow 和 Session transcript。Worker 只来自当前 Gateway 已配置且通过双重授权的 OpenClaw Agent；本地独立 AI 进程不是 Worker 来源或 fallback。

### 0.4 已定决策

1. Collaboration Plugin 是协作领域控制器；Desktop 只查询状态和提交命令。
2. `collaboration.sqlite` 是计划、工作图、Attempt、人工决定、交付和归档的权威来源。
3. Managed Task Flow 是协作级运行镜像，不是 Worker 调度器，也不是长期归档来源。
4. V1 不对 Worker 调用 `managedFlows.runTask()`；Native `subagent.run()` 与 ACP `sessions_spawn` 各自创建对应的真实执行 Task，禁止再制造第二套协作执行 Task。
5. V1 的完成条件是原 transcript 精确写入确认。外部渠道发送是独立、可选的 Delivery leg，不等同于 transcript 完成。
6. V1 不实现 Workboard；未来即使增加镜像，它也不能成为正确性来源或第二个调度器。
7. 每个原生 `(originRuntimeId, originAgentId, originSessionKey, originSessionId)` 同时只允许一个活动运行。
8. 默认必须批准精确计划版本，模型不得静默拉起多个本地 Agent。
9. 所有运行状态由插件快照返回；UI 不根据动画、计时器或本地 Agent 列表推断。
10. 可执行 Worker 只来自当前 OpenClaw config，并同时通过插件 `allowedAgentIds` 与协调 Agent `subagents.allowAgents`；本机已安装的其他 AI 工具不会自动加入候选集。

### 0.5 V1 不做什么

- 不做固定“研究员 / 审查员 / 汇总员”角色模板。
- 不编排、调用或 hook 独立的本地 AI 进程；V1 唯一执行后端是 OpenClaw 公共 Plugin SDK 和当前 Gateway 已配置 Agent。
- Collaboration Plugin 的 SQLite 和 JSON 导出不保存构造后的完整 prompt、思维链、密钥或完整 Worker 转录；发给 OpenClaw Child Session 的消息及其 transcript 仍受 OpenClaw 原生留存策略管理。
- 不提供无法冻结正在运行 Agent 的“假暂停”；只提供“停止新分派”和“取消运行”。
- 不把 `allowAgents=["*"]` 写成默认配置。
- 不把平台发送成功解释成用户设备已经显示或已读。
- 不在 Workboard 不可用时降级成前端临时工作流。

### 0.6 当前实现与证据

当前代码已经形成可构建、可测试的业务闭环，事实来源如下：

| 范围 | 当前实现 | 主要证据 |
| --- | --- | --- |
| Plugin authority | 插件 `0.3.0`、SQLite schema v12、状态机、Durable Outbox、Attempt runtime 冻结、失败预算与延迟重试、lease/CAS、外部效果意图、reconcile、稳定 history/event cursor | `packages/junqi-collab/src/{schema,database,domain,service}.ts` |
| OpenClaw adapter | 仅使用 `openclaw/plugin-sdk/*` 公共入口；Strategy Dispatcher 隔离 Native 与 ACP 启动协议，Native 调用 `runtime.subagent.run()`，ACP 通过受信任 Gateway `tools.invoke -> sessions_spawn(runtime:"acp")` 走官方 ACP policy/backend；Adapter 统一使用 `runtime.tasks.runs` 查询/取消和收敛身份，ACP 等待走 `agent.wait`，结果读取走精确 transcript API；Flow 使用精确 controller lookup、执行 Policy 与 provisioning/closure Specifications；所有 awaitable runtime 调用受 operation-specific Deadline Decorator 约束 | `packages/junqi-collab/src/agent-dispatcher.ts`、`openclaw-adapter.ts`、`runtime-deadline.ts`、`provision-execution-policy.ts`、`managed-flow-*-specification.ts` 及对应测试 |
| 执行授权 | Effective Agent Authorization Specification 在 command 产生外部效果前重新读取配置、allowlist 和协调 Agent policy，并核对批准时的 capability hash；adapter 在 Native `subagent.run()` 或 ACP `sessions_spawn` 前再次防御性校验，Gateway 仍执行 ACP 自身的 policy/backend 检查 | `agent-authorization-specification.ts`、`service.ts`、`openclaw-adapter.ts` 及对应测试 |
| 写实例围栏 | 所有写 envelope 强制携带 `expectedCollaborationInstanceId` 并纳入 payload hash；插件在 mutation 前校验，所有首次与 replay 响应都返回权威 `collaborationInstanceId`，Desktop 只接受精确匹配 | `instance-identity-specification.ts`、`wire-codec.ts`、`collaborationStore.ts` 及对应测试 |
| 计划修订聚合 | `CurrentPlanScopeRepository` 统一当前计划指针、并发、完成谓词和历史计划隔离；修订要求全 Run、全 revision、全 Attempt kind quiescent，历史完成结果只审计、不提交到当前计划 | `current-plan-scope-repository.ts`、`service.ts` 及对应测试 |
| 精确交付 | Delivery Specification 固化 target/artifact/revision/effect key；以 `agentId + sessionKey + sessionId + idempotencyKey` 写回原 transcript；rebound 和 unknown 不伪装成功；终态提交重新计算 recovery blockers，不能用 `IDLE` 覆盖未解决 Intervention | `delivery-specification.ts`、`service.ts`、`openclaw-adapter.ts`、对应测试 |
| WorkItem/竞态闭环 | 纯函数 Attempt Recovery State Machine、Task authority、entity CAS、下一 Attempt 一次性补充输入、真实 Task 取消、UNKNOWN 人工对账、Command Result Committer | `task-recovery-policy.ts`、`service.ts`、对应测试 |
| 后台生命周期 | Lifecycle Supervisor 统一拥有定时器、single-flight、AbortSignal、错误观测和关闭 drain | `async-lifecycle.ts`、`async-lifecycle.test.ts` |
| 数据与留存 | 白名单持久化、凭据拒绝、有限 command receipt 与恢复保留区、稳定历史分页、全量活动扫描、JSON 导出/删除、可续跑 retention、严格 deletion facts、可恢复 tombstone cleanup | `persistence-policy.ts`、`run-deletion-repository.ts`、`run-deletion-policy.ts`、`database.ts`、`service.ts`、对应测试与 `README.md` |
| Desktop bootstrap | 精确 target/connection、固定包校验、原插件离线 tgz 与内容树 hash 备份、配置 ownership fence、严格健康确认、恢复和回滚；Managed Child/External fail closed | `src-tauri/src/commands/collaboration_bootstrap.rs` |
| 权限隔离 | 日常连接只有 read/write；Agent 管理使用一次性 admin transient socket，成功或失败都断开且不保存 token | `src/services/gateway/Connection.ts`、`index.ts`、`gatewayCredentialSecurity.test.ts` |
| Chat 闭环 | 消息锚点、计划审批、运行卡片、图/列表、Evidence、Intervention、历史、导出和全部恢复动作；连接/runtime 精确绑定、projection epoch 失效旧异步结果、事件时间线不完整状态显式展示 | `src/components/Collaboration/`、`src/components/Chat/CollaborationChatProvider.tsx`、`src/stores/collaborationStore.ts` |
| Session/维护门禁 | reset/delete 先建立持久 fence；缺失 collaboration RPC 只有经过 target/connection、插件目录和 durable state 的独立 absence proof，且在 core 调用使用点重新探测后才能回退；更新、存储迁移和修复先进入 maintenance 并核对活动运行；维护 lease 使用稳定 Desktop owner + lease-id 双栅栏，45 分钟期限覆盖 35 分钟绝对更新窗口并在使用点要求 37 分钟剩余窗口：30 分钟 package/fallback、5 分钟 Gateway 恢复/最终核验、2 分钟 IPC/回连/精确释放；普通完成同时核对权威状态与本地 `expiresAt`，不释放已过期 lease，必须显式 recovery；过期以 SQLite CAS 进入 fail-closed 恢复态并幂等创建 Intervention | `CollaborationAbsenceAttestation.ts`、`maintenance-lease-{specification,repository}.ts`、`terminal-attempt-completion-policy.ts`、`SessionMutationCoordinator.ts`、`MaintenanceCoordinator.ts`、对应测试 |
| Chat 原生消息适配 | 原生 ID 优先读取 `message.__openclaw.id`，兼容旧字段；history 内容统一归一为字符串，同时保留 block array 供 tool/thinking 投影，旧缓存也执行迁移 | `messageIdentity.ts`、`normalizeHistoryMessage.ts`、`normalizeGatewayMessage.ts` 及对应测试 |
| Chat 生产事务 | 所有可见发送入口统一进入 `ChatSendCoordinator`，失败显式落为可重试状态并释放 typing；草稿和二进制附件按 session 隔离，文件/语音使用官方 `chat.send.attachments`；模型/思考 mutation 与发送按 session 串行；history 使用 `offset/nextOffset`，保留未落盘乐观尾并支持 `chat.message.get`；Artifact 源码优先且 iframe 不授予脚本权限；Persona 只生成用户可见草稿，不伪造系统提示 | `src/services/chat/`、`ChatView.tsx`、`MessageInput.tsx`、`MessageBubble.tsx`、`chatStore.ts` 及 `CHAT-01..11` 回归测试 |
| 结算与残余风险 | `SettlementSpecification` 防止 partial 吞掉独立活动工作；terminal Run 对 active/UNKNOWN Attempt 统一设防；`ResidualExecutionRiskSpecification` 将远端 Task 未确认终止建模为持续 `ATTENTION_REQUIRED`，服务端动作和 UI 同步收紧 | `settlement-specification.ts`、`residual-execution-risk-specification.ts`、`run-deletion-policy.ts`、`CollaborationCard.tsx`、对应测试 |
| Worker phase fence | `WorkerPhaseRestorationPolicy` 将显式 stop、partial、maintenance 和 session mutation 的未解决事实作为持久恢复栅栏；Worker 终态只能结算 Attempt/WorkItem，不能擦除 `DISPATCH_RESUME` 入口 | `worker-phase-restoration-policy.ts`、`service.ts`、对应测试 |
| Partial decision/application fence | `PartialDecisionSpecification` 约束非空规范化选择、严格 durable codec、精确 plan revision 和 pending 期间 WorkItem/plan mutation；`PartialApplicationPolicy` 在事务前后阻断 maintenance、session mutation 和 closure 外 Intervention；应用前重算 DAG closure，closure 聚合当前 plan 的 UNKNOWN/active Attempt | `partial-decision-specification.ts`、`partial-application-policy.ts`、`service.ts`、对应测试 |
| Intervention resolution fence | retry 与 run cancellation 通过纯策略区分可由当前操作替代的本地事实和必须保留的外部 blocker；只解析当前 WorkItem 的终态 predecessor，或取消明确 supersede 的本地 Intervention | `intervention-resolution-policy.ts`、`service.ts`、对应测试 |
| Attempt action projection | 服务端按 `ResidualExecutionRiskSpecification` 投影 `canAbandonWithResidualRisk`；取消命令进入终态时由 Command Result Committer 原子推进 Run revision/event 水位；旧 wire 缺失默认 false，UI 不自行猜测后端必拒动作 | `service.ts`、`wire-codec.ts`、`runActions.ts`、对应测试 |
| Export sidecar | 导出失败只改变 `export_jobs`，不改变 orchestration Run 或命令恢复语义；Delivery 仍按原 effect key 收敛 | `service.ts` 的 export command handler、对应 service regression |

2026-07-20 当前源码验证：`packages/junqi-collab` canonical `npm test` **364/364**、Desktop TypeScript/React **766/766**、发布/真实 Gateway 辅助脚本 **192/192** 通过；插件 package contract、Desktop production build、lint 和 425 文件模块边界检查通过。Rust 门禁尚未在当前 archive 上重跑。这些数字是本次审计快照，不是未来版本的固定承诺。可长期维护的验证入口是：

```bash
npm run collab:test
npm test
npm run test:rust
npm run lint
npm run build
(cd src-tauri && cargo fmt --all -- --check)
(cd src-tauri && cargo check --all-targets)
git diff --check
```

当前源码 bundle archive SHA-256 为 `62fa1fcacf338b7f4e735f2726b999f4640a5db5de3f2f0fbfe492e11dc6c6fe`；生成 metadata 与 Tauri resource metadata 一致，报告 plugin `0.3.0` / schema `12`，155 个白名单文件通过 package validator。现有 structural P0-01 和 payload-free behavioral P0-02/03/05/06/07/08 evidence 绑定上一版 `bea9b0ac...` archive，只能作为历史记录，不能证明当前包。当前 archive 的真实 Gateway、P0-04/09/10/11/12/13/14、浏览器视觉 QA 和 24 小时故障注入/soak 均仍未完成；不得用结构 smoke、局部真实行为、mock、单元测试、DOM/SSR 测试或当前用户 profile 代替这些门槛。

发布安全补充：2026-07-20 已将远端 `main` 的 `1956f23`（`1.2.27`）三方合入当前功能分支，合并提交为 `5aa8901`，主线基线落后问题已关闭；这不等于生产发布验收通过。`release.yml` 已移除 `v*` 自动触发；`release-source-policy.mjs` 和三个 evidence producer 在可信默认分支 promotion controller 出现前返回 `TRUSTED_PROMOTION_REQUIRED`。候选构建固定 pnpm `9.15.9`、Rust `1.96.0`，显式关闭 updater artifacts 且不生成一方 attestation；正式 producer publish 根和 release validator 下载副本执行共享文本 scanner，quality/structural/binary 内容仍是明确 residual。soak/Linux self-hosted 的 runner preflight 目前只读取受保护 repo boolean，不能证明实际 job 使用 JIT、online 或一次性 runner。workflow 已校验 evidence JSON 声明的 producer attempt 不大于当前 run attempt，但 attestation JSON 仍未解析并以签名 predicate 绑定所选 run id/attempt；未来 controller 身份与目标 tag/source 身份的双绑定也未完成。主线的 updater manifest 生成器已经保留，但当前发布资产合同尚未纳入最终签名资产和 `latest.json`，仍须完成仓库 `main` protection、tag ruleset、required-reviewer environments、唯一 promotion writer 和签名 secret scope 配置；最后一次 tag/release 检查后的远端并发写窗口仍由这些外部治理门禁覆盖。

---

## 1. 身份与统一术语

### 1.1 核心实体

| 术语 | 定义 | 不是 |
| --- | --- | --- |
| Runtime Identity | 当前实际连接的 OpenClaw Gateway 和插件实例身份 | 本机某个 CLI 的版本 |
| Chat Session | 由 `sessionKey + sessionId` 标识的一次原生会话实例 | 仅 `sessionKey` |
| CollaborationRun | 从一条原生用户消息发起的一次协作执行 | 流程模板 |
| PlanRevision | 不可变、可批准的任务图版本 | 可原地改写的草稿 |
| WorkItem | 可指派、可验收的最小工作单元 | 一段自由文本 |
| Attempt | 一次 Planner、Worker 或 Synthesizer 的实际 Agent 执行 | WorkItem 本身 |
| Evidence | 白名单序列化的摘要、引用、验证和产物 | 完整 Worker 转录 |
| FinalArtifact | 汇总完成后冻结的最终结论 | 渠道发送结果 |
| Delivery | 将 FinalArtifact 写入指定 transcript，并可选镜像到渠道 | 再运行一次 LLM |
| Intervention | 需要用户或控制器处理的结构化阻断项 | 一个自由文本错误 |

### 1.2 RuntimeIdentity

Desktop 将 Tauri 运行时探测和插件健康响应合并为：

```text
gatewayEndpoint
collaborationInstanceId      # 插件首次启动时持久化的 UUID
openclawVersion
pluginVersion
pluginApiVersion
schemaVersion
runtimeMode                  # SYSTEM_SERVICE | DOCKER | EXTERNAL | MANAGED_CHILD | UNKNOWN
backgroundDurability         # DURABLE | EXTERNALLY_MANAGED | DESKTOP_BOUND | UNKNOWN
installAuthority             # NATIVE | DOCKER | MANUAL | NONE
trustTier                    # PORTABLE_EXTERNAL | TRUSTED_OFFICIAL
capabilities[]
```

必需 capability 至少包含：`EXACT_TRANSCRIPT_IDENTITY`、`PLUGIN_SUBAGENT_TASK_LOOKUP`、`PLUGIN_SUBAGENT_TASK_CANCEL`、`WRITE_INSTANCE_FENCE`。`SESSION_RESET_CAS` 单独声明；OpenClaw `2026.7.1` 的 `sessions.delete` 已支持 `expectedSessionId`，但 `sessions.reset` 尚无等价参数，不能假装两者能力相同。

规则：

- `MANAGED_CHILD` 和 `UNKNOWN` 不允许创建 V1 协作运行。
- `EXTERNAL` 可以使用已经健康的插件，但 JunQi 不自动修改本机配置或安装插件。
- `collaborationInstanceId` 变化时，Desktop 必须清空该连接对应的协作缓存并重新拉取快照；旧投影持有的写请求不得自动改绑到新实例。
- 本机 CLI 版本、端口 TCP 可连接和当前 Gateway 身份是三件不同的事，不能互相替代。

### 1.3 OriginRef

`CollaborationRun` 必须携带不可变的发起引用：

```text
originRuntimeId
originAgentId
originSessionKey
originSessionId
originMessageId             # chat.history 返回的 transcript message id
originClientMessageId       # JunQi chat.send 使用的稳定 idempotency key
originCreatedAt
```

`sessionKey` 单独不能定位发起上下文。OpenClaw reset 后相同 `sessionKey` 会对应新的 `sessionId`。

JunQi Chat 必须先完成以下基础改造：

1. `ChatMessage` 拆分 `uiMessageId`、`clientMessageId`、`nativeMessageId`。
2. `Session` 保存 `nativeSessionId`，不得在 `sessions.list` 或 `chat.history` 映射时丢弃。
3. `chat.send` 使用 `clientMessageId` 作为稳定幂等键，并传入当前 `sessionId`。
4. optimistic message 与 history 对账后保留原生 ID，领域引用不得继续使用渲染 ID。
5. 原生引用未落盘时，协作入口显示“正在确认消息”，不能调用 `plan.create`。

OpenClaw `2026.7.1` 的真实 history 消息并不保证顶层 `id` 或单一内容形态。JunQi 的 Anti-Corruption Layer 遵守以下合同：

1. 原生消息身份优先读取 canonical `message.__openclaw.id`，仅在缺失时兼容 `id/messageId`；身份必须是有界且不含控制字符的非空字符串。
2. history 的 `content` 可能是字符串，也可能是 `[{type: "text", ...}]` 等 block array；领域和 React 渲染使用归一后的纯字符串，不能把数组传给 `.trim()` 或文本节点。
3. 原始 block array 单独保存在 `rawContent`，继续供 tool/thinking 解析，不因文本归一化丢失结构化投影。
4. 本地旧 Chat cache 在读取时执行同一内容迁移；不能假设只有新 Gateway 响应需要归一化。
5. OpenClaw 持久化的 user idempotency key 可能带 `:user` 后缀；对账前只对 user role 规范化该已知后缀。
6. 首屏与向前翻页统一使用 `chat.history({ offset })` 返回的 `hasMore/nextOffset`；`nextOffset` 不前进时立即停止，不能把 message id 当 offset cursor。
7. history 快照只能替换已匹配的本地消息；未匹配的 pending/queued/failed 或 streaming 尾消息继续保留，并由后续 canonical history 收敛。
8. `__openclaw.truncated`、`reason` 和 `seq` 必须保留；用户显式加载时以 `chat.message.get(sessionKey, messageId)` 原子替换同一 UI message。
9. `chat.send.message` 必须等于用户可见内容。JunQi 不向首条 user message 注入隐藏 Desktop context，也不调用协议未定义的 `sessions.patch.systemPrompt`。

### 1.4 执行引用

当前公共 SDK 路径中，`subagent.run()` 返回稳定的 `runId`；插件随后可按 owner session 查询真实执行 Task 并补全 `taskId`。Attempt 实际保存：

```text
openclawRunId
openclawTaskId nullable
workerOwnerSessionKey
childSessionKey
```

`childSessionKey` 是插件传入并持久化的会话 key。当前公共 SDK 没有向该调用暴露稳定的 child `sessionId` 或自动 mirrored Flow id，因此 V1 不持久化、不展示 `workerSessionId` / `openclawMirroredFlowId`，也不能把它们当作恢复前提。禁止使用一个含义不明的 `taskId` 同时表示 Managed Flow 子 Task 和真实 Subagent Task。

---

## 2. 权威边界与持久存储

### 2.1 数据权威

| 数据 | 权威来源 | 说明 |
| --- | --- | --- |
| 运行、计划、WorkItem、Attempt、用户决定 | Collaboration Plugin SQLite | Desktop 只做投影 |
| Agent 真实执行状态 | OpenClaw Agent / Task / Session runtime | 插件负责对账 |
| 协作级流程状态和取消意图 | Plugin SQLite；Managed Flow 为运行镜像 | Flow 不保存完整领域图 |
| 原始聊天与最终结论 | 精确 `sessionId` 对应的 transcript | `sessionKey` 不能替代 |
| Workboard 卡片 | V1 无此数据 | Portable Core 固定报告不支持；第 9 节仅是未来边界 |
| UI 展开、筛选、布局 | Desktop 本地偏好 | 不得影响业务状态 |

### 2.2 collaboration.sqlite

插件在 `OpenClawPluginServiceContext.stateDir` 下创建独立数据库并使用 WAL、显式 migration 和完整性检查。当前物理版本为 `SCHEMA_VERSION = 12`，表和职责如下；本表描述实际 schema，不是概念模型。

| 表 | 核心字段 | 用途 |
| --- | --- | --- |
| `metadata` | key, value, updated_at | instance id、schema version、maintenance 等元数据 |
| `collaboration_runs` | origin ref, status, dispatch state, revisions, sticky cancel intent, outcome | 运行主记录 |
| `plan_revisions` | revision no, plan JSON, digest, approved_at/by | 不可变计划及批准事实 |
| `work_items` | plan ref, dependencies, assignment, status, revision | 当前工作图投影 |
| `attempts` | kind, attempt no, frozen execution runtime, owner/child session key, run/task ref, structured input, status, entity revision, outcome | 每次 Agent 执行；恢复、查询和取消使用批准时冻结的 runtime，终态更新使用 CAS |
| `evidence` | typed summary, reference, verification, warnings | 裁剪证据 |
| `final_artifacts` | immutable content, digest, synthesis attempt | 最终结论 |
| `deliveries` | target revision, requirement, status | 交付聚合 |
| `delivery_attempts` | effect key, receipt, status, error | 每次交付尝试 |
| `interventions` | code, entity ref, required action, resolution | 结构化人工介入 |
| `commands` | command id, payload hash/json, effect key, status, attempts, failure_count, effect_started_at, available_at, lease owner/expiry | Durable Outbox、租约代际、业务失败预算、外部效果意图和延迟重试 |
| `collaboration_events` | monotonic sequence, entity, payload | 可追溯时间线 |
| `decisions` | command id, actor, decision type, payload | 用户/控制器决定 |
| `work_item_inputs` | work item, command id, content | 内部补充输入；其 id 只绑定一次到下一 Attempt 的 `input_json` |
| `export_jobs` | run id, status, managed artifact path, digest, error | 异步 JSON 导出 |
| `deletion_jobs` | confirmation digest, status, error | 可恢复删除 |
| `deletion_command_receipts` | command/run/job id, payload hash, response | 删除级幂等回执，Run 级联删除后在 `retentionDays` 内保留 |
| `command_receipts` | command id, concrete RPC/operation source, optional run id, payload hash, response | 外部写命令的统一有限期重放回执 |
| `command_receipt_conflicts` | command id, diagnostic, created_at | v6 迁移引入；只隔离发生旧 namespace/hash 冲突的 command id |
| `session_mutations` | runtime/session identity, action, policy, lease, result | reset/delete 持久栅栏 |
| `session_mutation_commands` | command/mutation id, operation, payload hash, response | session mutation 幂等回执 |
| `tombstones` | run id, actor, content digest, authoritative deletion job id, deleted_at, cleanup status/error/time, Flow reconciliation command/Flow/revision/diagnostic/abandon time/reason | 删除审计、精确删除任务恢复、显式 Flow 对账弃置证据和物理清理恢复 |

Capability snapshot 存在 `collaboration_runs.capability_snapshot_json`，批准事实存在 `plan_revisions` / `decisions`；当前没有 `capability_snapshots`、`approvals`、`workboard_mirrors` 或附件表。

schema 12 的显式索引为：

```sql
UNIQUE collaboration_runs_active_origin
  (origin_runtime_id, origin_agent_id, origin_session_key, origin_session_id)
  WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED')

collaboration_runs_session(origin_session_key, origin_session_id, updated_at DESC)
collaboration_runs_status(status, updated_at DESC)
collaboration_runs_history(created_at DESC, id DESC)
collaboration_runs_retention(ended_at, id)
  WHERE status IN ('COMPLETED', 'CANCELLED', 'FAILED') AND ended_at IS NOT NULL
work_items_run_status(run_id, status, updated_at)
attempts_active(status, updated_at)
  WHERE status IN ('CREATED', 'DISPATCHING', 'RUNNING', 'CANCELLING', 'UNKNOWN')
attempts_run_active(run_id, status)
  WHERE status IN ('CREATED', 'DISPATCHING', 'RUNNING', 'CANCELLING', 'UNKNOWN')
interventions_open(run_id, resolved_at, created_at)
commands_pending(status, lease_expires_at, created_at)
commands_available(status, available_at, lease_expires_at, created_at)
commands_run_active(run_id, status, kind, id)
  WHERE status IN ('PENDING', 'LEASED', 'UNKNOWN')
commands_run_failed_flow(run_id, kind, created_at DESC, id DESC)
  WHERE status = 'FAILED' AND kind IN ('PROVISION', 'FLOW_SYNC')
collaboration_events_run_sequence(run_id, sequence)
export_jobs_run_status(run_id, status)
deletion_jobs_run_status(run_id, status)
deletion_command_receipts_run(run_id, created_at)
command_receipts_run(run_id, created_at)
UNIQUE session_mutations_active(runtime_id, session_key, session_id)
  WHERE status = 'PREPARED'
UNIQUE session_mutations_unresolved(runtime_id, session_key, session_id)
  WHERE status IN ('PREPARED', 'EXPIRED')
session_mutation_commands_mutation(mutation_id, created_at)
tombstones_deleted_at(deleted_at DESC, id DESC)
```

应用层“先查询再创建”不能替代该约束。

### 2.3 命令 outbox

SQLite 写入和 OpenClaw 调用不能组成同一个事务，所有外部副作用必须使用 outbox：

```text
PENDING -> LEASED -> SUCCEEDED | FAILED | UNKNOWN | CANCELLED
```

执行规则：

1. 领域状态、审计事件和 `PENDING` 命令在同一 SQLite 事务提交。
2. 执行器 lease 命令后，在真正调用 OpenClaw 前重新检查运行状态、调度闸门、计划版本和实体 revision。
3. 稳定 effect key 由插件派生，客户端不能自由提供。
4. `attempts` 只表示 command 被成功领取的 lease/CAS 代际；每次重新领取递增，用于拒绝旧 Worker 的迟到提交。它不是业务失败次数，也不能决定重试耗尽。
5. `failure_count` 才是 PROVISION/FLOW_SYNC 的业务失败预算。基础设施维护、session mutation 或暂时 fence 造成的 defer 不增加该值；`FailureRetryPolicy` 根据 `failure_count` 和各命令的有界 backoff 计算下一次 `available_at`。人工 `RECONCILE` 重开同一 command/effect 时只清零失败预算，保留 lease 代际与外部效果证据。
6. 过期的 `LEASED` 会先回到 `PENDING` 再重新领取；`available_at` 是持久化的最早可领取时间。即使 lease 重领，执行器仍须按 effect key、run id、controller 和远端引用对账。
7. 对可能创建外部对象的 PROVISION，在调用 OpenClaw 前以 lease CAS 首次写入 `effect_started_at`。该字段是“外部效果可能已经开始”的持久意图证据，不表示成功；重启后不得根据 `attempts` 猜测是否已经调用过远端。
8. `FAILED` 表示已知失败，不会被 lease 扫描自动重领；`UNKNOWN` 表示副作用无法判定，禁止盲重发，并阻止依赖该结果的自动推进。若 Native `subagent.run()` 或 ACP `sessions_spawn` 可能已启动但响应丢失，原 command 和原 Attempt 一起进入 `UNKNOWN`，保留同一 effect/idempotency key；Native 按确定 child session 对账，ACP 按确定 label 对账并校验唯一 Task/child session；恢复只能对账该 Attempt，不能新建替代 Attempt。
9. `EXPORT`、`DELETE` 和其他终态远端命令在恢复时有实体/文件对账；无法确认的副作用进入 Intervention 或保留失败诊断。Attempt timeout 必须在同一事务把 Attempt 置为 `CANCELLING` 并确保带 `terminalReason=TIMEOUT` 的 `CANCEL_ATTEMPT` outbox；只有远端 Task 取消得到确认才能写 `TIMED_OUT`，否则保持 `UNKNOWN` 和 Intervention。
10. 外部写命令的重放身份是 `commandId + source + payloadHash`。`source` 绑定具体 RPC 或稳定 operation，例如 `junqi.collab.plan.create`、`RUN:DISPATCH_STOPPED`、`WORK_ITEM:INPUT_APPENDED`、`DELIVERY:DELIVERY_RETRY_CREATED`、`SESSION_MUTATION:PREPARE`；相同 command id 改用其他 source 或 payload 时返回 `IDEMPOTENCY_CONFLICT`。
11. 只有携带外部 `commandId` 的写 RPC/operation 建立 receipt；controller 自动生成的 dispatch、watch、reconcile 等内部命令不占 receipt 容量。每个 Run 的普通操作最多 4,096 条；达到该边界后，仅 `DISPATCH_STOPPED`、Run/WorkItem cancel、delivery abandon 和 delete/delete retry 等终止恢复操作可以使用额外 64 条保留区，因此每个 Run 的物理总上限仍为 4,160。`run_id IS NULL` 的 maintenance/session receipt 全局最多 10,000 条。任一对应上限耗尽时，在写入副作用前返回 `CAPACITY_EXCEEDED`。
12. Run 级联删除后，统一 receipt 和删除专用 receipt 继续支持重放，但只保留至该删除时间超过 `retentionDays` 且 tombstone cleanup 已完成；随后 sweep 删除 receipt，永久审计只剩 tombstone。无 Run 的 receipt 也按 `retentionDays` 清理，但仍处于 `PREPARED/EXPIRED` 的 session mutation 不清理。
13. v6 迁移遇到旧 command id 跨命名空间或 payload hash 冲突时，将该 id 写入 `command_receipt_conflicts` 并只拒绝该 id 的后续重放；数据库继续完成迁移和启动，不把单条历史冲突升级为全库不可用。

### 2.3.1 生产级一致性模式

当前实现把设计模式落在真实故障边界，而不是仅用命名包装：

- **State Machine**：Run 的合法迁移由领域状态机约束；UNKNOWN Attempt 的 Task 观察通过纯函数 reducer 生成 `NOOP/KEEP_UNKNOWN/CAPTURE_AND_WATCH/REQUEST_CANCEL/SETTLE` 决策，副作用由 service 层执行。
- **Durable Outbox + Failure Retry Policy**：所有 OpenClaw 外部效果先与领域状态同事务写入 `commands`；`attempts` 只做 lease fencing generation，`failure_count` 才进入失败预算，`available_at` 持久化 Policy 计算出的下一领取时间。基础设施 defer 不消耗业务失败预算。
- **Write-ahead Effect Intent**：PROVISION 在远端调用前以当前 lease CAS 写 `effect_started_at`；它只证明效果可能开始，恢复仍须精确 lookup，不能把 intent 当成功回执。
- **Lease + CAS**：命令所有权绑定 `id + lease_owner + attempts`；旧 Worker 丢 lease 后不能提交结果。必要的长操作先续租，实体更新还需精确 status/revision。
- **Command Result Committer**：`commitClaimedCommandResult()` 在同一 SQLite 事务中先 CAS 结算当前命令，再提交 Delivery、Cancellation 或 Flow 的领域结果；命令 CAS 失败时整个领域写入不发生。Cancellation command 从 actionable 进入终态时还原子增加 Run revision 并写 `ATTEMPT_CANCELLATION_COMMAND_SETTLED`，保证服务端授权投影变化具有单调可观察水位。
- **Nested Unit of Work + 同步事务护栏**：数据库在已有事务内使用 SAVEPOINT；内层失败只回滚到 savepoint，外层仍可决定继续或整体回滚。类型层拒绝异步 callback，运行时还检测任何 `PromiseLike` 并在 commit 前抛错回滚，禁止 `async` 越过 better-sqlite3 的同步事务边界。
- **Provision Execution Policy**：`PROVISIONING` 且无基础设施 fence 才允许 `CREATE_OR_RECOVER`；fence 下 `DEFER`；`CANCELLING` 和全部终态只能 `OBSERVE_ONLY`，因此收敛路径不会新建 Flow，也不会因维护 fence 与“取消后等待”互相死锁。
- **Managed Flow Specifications**：共享 identity specification 校验 Flow id、controller、run id、revision 范围、状态和 cancel timestamp；provisioning specification 只接受未请求取消的 `running` Flow；closure specification 将终态 Run 映射到目标 Flow 终态，并区分可收敛观察与身份/状态冲突。
- **Delivery Specification**：精确 transcript target、FinalArtifact digest、target revision、attempt no 和 effect key 形成不可变值对象；UNKNOWN 重用原 effect，只有已知未发送的 RETRY_REQUIRED 才创建新 effect。Delivery 确认成功后重新读取全 Run recovery blockers；存在无关未解决 Intervention 时，终态保留 `ATTENTION_REQUIRED`，不能无条件覆写为 `IDLE`。
- **Effective Authorization Specification + Defense in Depth**：service 在 `CREATED -> DISPATCHING` 的 pre-effect 事务中核对当前 Agent 配置、插件 allowlist、协调 Agent policy 和批准时 capability hash；授权已撤销时原子结算 command/Attempt/WorkItem/Run 并创建 Intervention，不调用 runtime。adapter 在 `subagent.run()` 前再次执行同一有效授权判定，防止未来调用路径绕过应用层。
- **Instance Identity Specification**：`expectedCollaborationInstanceId` 是所有外部写 envelope 的必填字段并参与 canonical payload hash；server 在任何 mutation/receipt 创建前精确比较权威实例，响应和 replay 都回传实际 `collaborationInstanceId`，Desktop codec 再做对称校验。这是 `0.3.0` 的破坏性 wire contract，`0.2.x` 写 envelope 不被静默兼容或自动改绑。
- **Protocol Error Code Contract**：插件和 Desktop 的错误码都从只读常量派生联合类型，Desktop 使用统一 type guard 解析结构化 RPC 错误；跨包契约测试断言插件公开错误码是 Desktop 识别集合的子集。`RUNTIME_TIMEOUT` 等可操作错误不会降级为泛化 `RPC_FAILED`，未知值仍 fail closed。
- **Typed Read Facade + Decoder Strategy Registry**：`CollaborationReadRpcContract` 是 partial/delete preview、deletion job、export job/download 与 session mutation impact 的参数/返回类型单一来源；`decodeCollaborationReadResponse()` 通过穷尽 registry 分派共享 decoder，统一拒绝非法整数/时间戳/枚举/nullable、camel/snake alias 冲突、重复集合、跨 Run/Job/Session 身份和互相矛盾的 fence 状态。`CollaborationClient` 的六个命名方法是生产入口；action/coordinator 测试显式注入 raw transport 时仍先经过同一 registry，因此测试替身不能绕过生产 wire 边界。session mutation prepare 的 slim projection 单独建模为 `CollaborationRunReference`，不会用空 goal、空 actions 或零 event watermark 冒充完整 `CollaborationRunSummary`。业务层只保留 `PREVIEW_STALE`、`SESSION_IDENTITY_MISMATCH`、超时和确认策略等领域语义。
- **Current Plan Aggregate Repository**：`CurrentPlanScopeRepository` 是当前计划指针、READY dispatch、并发、完成谓词、上游 Evidence 和历史 WorkItem 拒绝的统一查询边界。`plan.revise` 在事务前后都要求全 Run、全计划 revision、Planner/Worker/Synthesizer 的活动或 `UNKNOWN` Attempt 全部静止；历史 Worker/Synthesizer 的迟到完成只能进入 `ABANDONED` 审计，不能提交到当前图。
- **Settlement Specification**：`SettlementSpecification` 把 current-plan required settlement、partial waiver closure 和全 Run active/UNKNOWN quiescence 分成显式谓词；不相关的活动 WorkItem 不能被 partial 隐式吞掉，`enqueueSynthesis` 和 terminal transition 都执行第二道防御性断言。
- **Worker Phase Restoration Policy**：`WorkerPhaseRestorationPolicy` 将 `DISPATCH_STOPPED` 等未解决 Intervention、pending partial、maintenance 和 session mutation 统一建模为 phase fence。Worker 终态可以安全结算 Attempt/WorkItem，但只能在所有 fence 清除后恢复 Run phase；显式 stop 不会被迟到结果隐式清除。
- **Partial Decision Specification**：`PartialDecisionSpecification` 对 logical id 选择和 durable payload 做非空、去重、边界、规范化、交叠和精确 shape 校验，并把 durable decision 绑定到 exact `planRevisionId`。应用前按当前 plan DAG 重算 closure；腐坏或漂移会原子 supersede decision 并进入 Intervention。pending decision 在 WorkItem mutation 和计划修订的事务前后都形成写栅栏；当前 plan 的 UNKNOWN Attempt 也计入 active closure。
- **Partial Application Policy**：`PartialApplicationPolicy` 是无副作用的 application policy，在进入事务前和事务内分别重验 maintenance、session mutation 与 closure 外未解决 Intervention。只有 policy 返回 `PROCEED`，且 closure 内 Intervention 已按当前 plan logical id 精确解决、全 Run blocker 重算为空，才允许 waive 并进入 synthesis；旧损坏 decision 必须由一次新的显式 accept 关闭，不能被自动绕过。
- **Intervention Resolution Policy**：`InterventionResolutionPolicy` 将 retry 与 run cancellation 的“可由本地操作替代”事实和“仍需外部对账”的 blocker 分开分类。Retry 只解决当前 WorkItem 的终态 predecessor Attempt；取消只解决 dispatch/work-item/终态 Attempt/partial decision 等本地事实，Flow、maintenance、session 和 residual-risk Intervention 保持开放并驱动 `ATTENTION_REQUIRED`。
- **Attempt-level Action Projection**：服务端复用 `ResidualExecutionRiskSpecification` 计算 `canAbandonWithResidualRisk`，将取消命令状态、effect intent 和 reconciliation evidence 投影到 Attempt snapshot。Cancellation command 的终态结算同步推进 Run revision/event 水位；Desktop 只消费该事实，wire 缺失字段默认 false，避免旧插件、不完整快照或相同水位提示扩大/隐藏授权。
- **Terminal Attempt Completion Policy**：`TerminalAttemptCompletionPolicy` 按 Planner/Worker/Synthesizer kind 映射 active Run phase，并要求 exact `resume_status`；维护过期造成的本地冻结只能在事务内桥接回对应 phase，不能靠宽松状态判断结算。
- **Maintenance Lease Specification + Repository**：lease 被严格有界解析，并以 SQLite CAS 区分 ACTIVE/EXPIRED/MALFORMED。过期时保持全局 gate 关闭，幂等地为每个活动 Run 写 `MAINTENANCE_LEASE_EXPIRED` 事件与 Intervention；只有精确 lease owner 的 exit 才释放，且不会自动恢复 Run。损坏 lease 同样 fail closed，禁止按“看起来超时”删除。
- **Sidecar Isolation**：EXPORT 是只读审计旁路，失败只结算自身 job；service handler 早退保证它不能改变 orchestration Run、制造 `COMMAND_FAILED` intervention 或污染 Delivery recovery。
- **Residual Execution Risk Specification**：普通 terminal quiescence 仍是硬不变量；只有显式接受、证据充分且无可执行 cancellation 的 UNKNOWN Attempt 才能走受控 `ABANDONED` 例外。例外把风险持久化为 `ATTENTION_REQUIRED`/Intervention，并同步收紧 clone/delete/retention/late-result 行为。
- **Runtime Deadline Strategy/Decorator**：所有 Origin read、Flow、Agent、Task、Session、取消和 transcript runtime await 都有 operation-specific 有界 deadline；超时产生结构化 `RUNTIME_TIMEOUT`，清理 timer 并吸收迟到 resolve/reject。可能已经产生外部效果的超时仍遵循原 effect key 和 `UNKNOWN` 对账，不能因 timeout 自动重发。
- **Lifecycle Supervisor**：所有后台任务、single-flight、定时扫描、延迟任务和 runtime await 统一受 AbortSignal 管理；stop 会取消 timer、阻断迟到结果并 drain 已登记任务。
- **Task authority**：OpenClaw persistent Task 是 Agent 执行事实来源；`waitForRun()` 只是唤醒提示。恢复必须核验 runtime、owner session、child session、run id 和已有 task id，缺失、歧义或不匹配均 fail closed。
- **Atomic Terminal Mirror Repair**：Run 进入 `COMPLETED/CANCELLED/FAILED` 与对应 `FLOW_SYNC` outbox 在同一 SQLite 事务提交；启动恢复还扫描并原子补建缺失的终态 sync command，之后仍由 command lease/CAS 收敛。

### 2.4 保留策略

- 结构化运行、决定、证据摘要和最终结论默认长期保留，用户可以配置 `retentionDays`。
- V1 只管理 `exports/` 下由插件生成的 JSON 导出文件；没有附件上传、附件表、外部产物复制或独立附件留存策略。Evidence 中的 artifact 仅是有界引用字符串。
- OpenClaw Task、Flow 和 Child Session transcript 由 OpenClaw 原生留存策略管理。删除 JunQi 协作行或 JSON 导出不会删除这些对象，也不会删除 JunQi Chat history。
- 自动 retention 的 Query Repository 只提供有索引的宽候选流：终态、`ended_at < cutoff`、稳定 `(ended_at,id)` cursor。Cursor 直到有序扫描耗尽才清空，page/batch/250ms budget 截断会保留断点并在服务运行时安排 1 秒 continuation，不会因固定 24 小时回头而饿死后续候选。
- Retention application policy 才是删除资格权威：只接受 `reconcile_state=IDLE` 且没有活动/未知 Attempt、活动/未知 command、待处理 export/deletion 的过期终态 Run；任何 failed PROVISION/FLOW_SYNC 都是硬阻断。该 policy 没有 abandonment 参数，因此结构上不具有放弃 Flow 对账的权限。
- 删除 Query Repository 在单个 read Unit of Work 中严格解码 decision-complete facts，并最多读取两个稳定排序 blocker witnesses，只表达 0、1、至少 2，不宣称完整 blocker 数量。损坏的持久化状态、时间或 Flow revision 返回 `INVALID_RESPONSE`。
- `command_receipts` 不是永久审计表：Run 删除后最多再保留 `retentionDays`，到期且物理 cleanup 完成后删除；tombstone 继续保留 run id、actor、digest、删除时间和 cleanup 状态。
- 删除预览和 tombstone 使用 `junqi-collaboration-content/v3` SHA-256 domain-content digest。覆盖 `collaboration_runs`、`plan_revisions`、`work_items`、`attempts`（含冻结的 `execution_runtime` 与结构化 `input_json`）、`evidence`、`interventions`、`final_artifacts`、`deliveries`、`delivery_attempts`、`collaboration_events`、`decisions` 和 `work_item_inputs`。
- v2 digest 明确不覆盖 `metadata`、`commands`、`export_jobs`、`deletion_jobs`、`deletion_command_receipts`、`command_receipts`、`command_receipt_conflicts`、两类 session mutation 表和 `tombstones`。它是版本化的领域内容删除护栏/指纹，不是数据库全量 hash，也不是用户 JSON 导出的 digest。

### 2.5 JSON 导出合同

V1 只支持 JSON。`junqi.collab.export.create` 先原子写入 `export_jobs=PENDING` 和 `commands=PENDING` 并返回 accepted；容量预检和文件生成由异步 worker 执行，因此“请求已受理”不等于“导出成功”。

worker 同时执行三层硬限制：

1. `collaboration_events` 不得超过 10,000 条。
2. 预检估算的保守 materialization budget 不得超过 64 MiB。
3. 最终序列化 JSON 文件不得超过 16 MiB。

任一限制、revision fence、文件校验或写入失败都会把 `export_jobs` 置为 `FAILED`，保留有界诊断并删除临时文件；客户端通过 `export.get` 读取终态。当前没有摘要导出或分卷 fallback，因此只能承诺“满足上述容量与一致性合同的快照可导出”，不能承诺任意 Run、尤其任意终态 Run 都无条件成功。

导出包含 capability snapshot、全部 plan revisions、裁剪后的 WorkItem/Attempt、Evidence、Intervention、Decision、FinalArtifact、Delivery/DeliveryAttempt、命令审计元数据和事件流。它明确排除构造后的 prompt、Attempt `input_json`、`work_item_inputs` 原文、command `payload_json`、完整 Child transcript、思维链和原始工具输出。

---

## 3. 运行前置、安装与安全

### 3.1 Gateway 运行模式

| 模式 | JunQi 关闭后运行 | 自动安装插件 | V1 行为 |
| --- | --- | --- | --- |
| `SYSTEM_SERVICE` | 是 | 是 | 允许启动 |
| 持久 `DOCKER` | 是 | 是，通过目标容器 | 允许启动 |
| `EXTERNAL` | 由外部负责 | 否 | 插件已健康时允许 |
| `MANAGED_CHILD` | 否 | 可安装但不满足持续运行 | 阻止启动，引导启用后台服务 |
| `UNKNOWN` | 未知 | 否 | 阻止启动 |

“关闭窗口”和“退出应用”必须在 UI 文案中区分。隐藏窗口可以继续连接，不代表退出进程后 Gateway 仍存在。

### 3.2 Collaboration Bootstrap Supervisor

插件缺失或损坏时不能依赖插件自己的 RPC 自救。Tauri 需要提供独立 Supervisor：

1. 从实际握手连接确认目标 runtime，不以 TCP 端口或本机 CLI 猜测。
2. 只对 JunQi 明确拥有且 Desktop 退出后仍持续运行的 System Service / persistent Docker 实例执行自动安装；Managed Child 即使本地可写也由后端直接拒绝。
3. 使用固定来源、精确版本和 hash/signature 校验插件包。
4. 展示文件、安装索引、`plugins.allow` 和 enable 配置的变更预览。
5. 调用 OpenClaw 标准 `plugins install --pin` / enable 流程，不直接伪造安装索引。
6. 重启真正提供当前连接的 Gateway，而不是错误的 wrapper 或另一套配置。
7. 调用 `junqi.collab.capabilities`，按当前 JunQi 内嵌 metadata 精确校验 instance id、插件版本、schema、`durableState`、`durableRuntime`/supported 和全部必需 feature；任一不匹配进入 `RecoveryRequired`。
8. apply 前从 OpenClaw install registry 的本地 `installPath`/已安装 `rootDir` 建立私有、耐久、hash 校验的精确 tgz 备份并记录安装树内容 hash；不能建立备份则在任何插件/配置变更前失败。回滚只允许使用该本地归档，禁止用 `resolvedSpec` 静默访问 registry，并在完成前复核归档 hash、安装树、版本、enable 状态和配置 hash。
9. 旧插件无法启动时，Supervisor 仍能提供诊断、回滚和数据库保全。

Supervisor 为每次操作保存独立 bootstrap journal，至少记录目标 RuntimeIdentity/connection fence、原插件版本、精确备份路径与归档/内容 hash、配置原始与 bootstrap-owned hash、已执行步骤、回滚步骤与最终诊断。恢复逻辑必须能够在 Desktop 或 Gateway 于任一步骤退出后继续或回滚，并拒绝覆盖外部修改过的配置。

对 `EXTERNAL` 实例只显示版本固定的手工安装说明，不自动修改本机 `openclaw.json`。

### 3.3 插件信任等级

Portable Core 必须能作为普通外部插件运行：

- 使用插件 service context 的 `stateDir` 和自有 SQLite。
- 使用公开 config snapshot、Agent runtime、Subagent、Task/Flow、事件和 transcript API。
- 不调用只允许 bundled / trusted official plugin 的 `api.runtime.gateway.request()`。
- 不依赖 Workboard。

V1 的 capability 响应固定为 `workboard.supported: false`，代码中没有 Workboard RPC、mirror 表或双写路径。Trusted Integration 只是未来扩展边界：只有 OpenClaw 提供并报告受支持的官方 capability 后才能另行设计；`plugins.allow` 只表示用户信任插件 ID，不等同于该 capability，也不能启用隐藏实现。

### 3.4 安全发布门槛

当前实现已把 Gateway token 从 WebView `localStorage` 迁移到系统凭据后端（不可用时仅保留进程内 session），日常连接只申请 read/write，admin 操作使用一次性 transient socket。以下仍是发布时必须持续满足的安全不变量：

1. Gateway shared token 只用于 bootstrap/pairing；日常连接优先使用按 `collaborationInstanceId` 隔离的 paired-device token。
2. Gateway/paired-device token 迁移到操作系统凭据库或原生 Gateway 代理，不再持久化到 browser storage；不允许使用明文文件 fallback。
3. WebView 只在内存中短暂持有连接凭据；升级时清理旧 `aegis-gateway-token` 和 `aegis-config.gatewayToken`。
4. Chat/Collaboration 使用 `operator.read + operator.write` 连接。
5. Agent CRUD、配置、配对等 admin 操作使用显式、短生命周期的高权限路径。
6. 停止为所有 operator 设备自动扩展 admin/approvals/pairing scopes。
7. Collaboration Plugin 配置显式 `allowedAgentIds`，默认不使用 `*`。
8. 插件把自身 allowlist 与协调 Agent 的 `subagents.allowAgents` 策略取交集并自行执行校验；不能假设 `runtime.subagent.run()`替插件强制该策略。
9. 计划批准不替代 OpenClaw 原生 exec / tool / plugin 审批。
10. Evidence 按字段白名单保存，禁止密钥、完整 prompt、推理内容和无界命令输出。

---

## 4. 领域状态机

### 4.1 运行状态与正交维度

`RunStatus`：

```text
DRAFT
  -> PLANNING
  -> AWAITING_APPROVAL
  -> PROVISIONING
  -> RUNNING
  -> SYNTHESIZING
  -> FINALIZING
  -> DELIVERY_PENDING
  -> COMPLETED

PLANNING / PROVISIONING / RUNNING / SYNTHESIZING / FINALIZING
  -> AWAITING_INTERVENTION

除 DELIVERY_PENDING 外的任意非终态 -> CANCELLING -> CANCELLED
DELIVERY_PENDING -> 显式 delivery.abandon -> CANCELLING -> CANCELLED
不可恢复的控制器/存储错误 -> FAILED
```

以下维度不得混入主状态：

```text
dispatchState  = OPEN | STOPPED | CLOSED
archiveState   = ACTIVE | ARCHIVED
reconcileState = IDLE | RUNNING | ATTENTION_REQUIRED
completionOutcome = null | FULL | PARTIAL
```

不变量：

- `dispatchState=OPEN` 只允许出现在 `RUNNING`。
- `COMPLETED` 必须有满足 requirement 的 Delivery 和 `FULL/PARTIAL` outcome。
- `FAILED` 只表示控制器、存储或协议不可恢复；Worker 业务失败进入 Intervention。
- 终态不可回退。
- 除显式接受残余风险的受控例外外，未解决的外部执行 `UNKNOWN` 或任何 active Attempt 存在时，不得进入 Run 终态，也不得自动创建可能重复副作用的新 Attempt。
- `COMPLETED/CANCELLED/FAILED` 的事务入口必须重新计算全 Run active/UNKNOWN Attempt 数；不能只检查当前 WorkItem 或 partial 选择闭包。
- 受控残余风险例外只允许 `CANCELLED + reconcileState=ATTENTION_REQUIRED`，并必须保留开放 Intervention；它不代表远端 Task 已 quiescent。
- `cancelRequestedAt` 是 sticky cancel intent；任何 await 后恢复的 watcher、partial 或 dispatch 都必须重新读取它，取消完成前不得用旧快照恢复正常推进。

### 4.2 Run 合法迁移

| 当前状态 | 条件/命令 | 下一状态 |
| --- | --- | --- |
| `DRAFT` | planner command accepted | `PLANNING` |
| `PLANNING` | schema/graph valid | `AWAITING_APPROVAL` |
| `PLANNING` | 可修正失败 | `AWAITING_INTERVENTION(resume=PLANNING)` |
| `AWAITING_APPROVAL` | approve exact revision | `PROVISIONING` |
| `AWAITING_APPROVAL` | revise | `PLANNING` |
| `PROVISIONING` | flow and initial state ready | `RUNNING` |
| `PROVISIONING` | 可恢复失败 | `AWAITING_INTERVENTION(resume=PROVISIONING)` |
| `RUNNING` | 用户停止新分派、节点失败、能力变化 | `AWAITING_INTERVENTION(resume=RUNNING)` |
| `RUNNING` | completion predicate satisfied | `SYNTHESIZING` |
| `AWAITING_INTERVENTION` | 问题解决且无需重批 | 保存的 resume status |
| `AWAITING_INTERVENTION` | 图、权限或副作用范围变化 | `AWAITING_APPROVAL` |
| `AWAITING_INTERVENTION` | partial closure accepted and settled | `SYNTHESIZING` |
| `SYNTHESIZING` | FinalArtifact frozen | `FINALIZING` |
| `SYNTHESIZING` | 汇总失败 | `AWAITING_INTERVENTION(resume=SYNTHESIZING)` |
| `FINALIZING` | Delivery created | `DELIVERY_PENDING` |
| `DELIVERY_PENDING` | transcript requirement confirmed | `COMPLETED` |
| 除 `DELIVERY_PENDING` 外的任意非终态 | cancel | `CANCELLING` |
| `DELIVERY_PENDING` | 显式 abandon 当前 idle Delivery | `CANCELLING`，随后 `CANCELLED` |
| `CANCELLING` | 所有外部执行已确认停止 | `CANCELLED` |
| `CANCELLING` | 取消结果不确定 | `AWAITING_INTERVENTION(reason=CANCEL_UNCONFIRMED)` |
| `CANCELLING` | UNKNOWN Attempt 满足残余风险合同且用户显式接受 | `CANCELLED + reconcileState=ATTENTION_REQUIRED` |

### 4.3 Intervention

`AWAITING_INTERVENTION` 不能只保存一个错误字符串。每条 Intervention 包含：

```text
id, code, entityRef, createdAt, resolvedAt,
requiredAction, diagnostics, resumeStatus
```

一次运行可以同时存在多个未解决 Intervention。插件快照返回服务端计算的 `allowedActions[]`，UI 不根据主状态自行猜测按钮。

### 4.4 WorkItem 状态

```text
PLANNED -> READY                         # 无必需依赖
PLANNED -> BLOCKED -> READY              # 必需依赖已成功
READY -> DISPATCHING -> RUNNING -> SUCCEEDED
                  |          -> NEEDS_INTERVENTION
                  |          -> CANCELLING -> CANCELLED
                  -> NEEDS_INTERVENTION

PLANNED / BLOCKED / READY / NEEDS_INTERVENTION -> WAIVED | CANCELLED
```

规则：

- 失败属于 Attempt；WorkItem 不设置含义重叠的 `FAILED`。
- `WAIVED` 只能由显式 partial 决定产生，并且不存在活动 Attempt。
- `WAIVED` 不自动解锁普通下游；partial preview 必须计算并展示被阻塞的后代闭包。
- 补充输入只追加到下一 Attempt：创建 Attempt 时把尚未消费的精确 input ids 写入该 Attempt 的 `input_json`，之后的 retry 不再重复使用；修改验收标准必须创建新 PlanRevision 并重新确认影响范围。
- 改派只允许没有活动 Attempt 的节点；超出已批准候选集时必须重规划、重批。
- 单节点取消先停止 Run 新分派并记录 Decision/Event/Intervention；有活动 Attempt 时必须通过 OpenClaw Task API 确认取消，不能仅把 WorkItem 改成终态。后续由用户选择 retry、partial、恢复分派或取消 Run。

### 4.5 Attempt 状态

```text
CREATED -> DISPATCHING -> RUNNING -> SUCCEEDED
                                  -> FAILED
                                  -> TIMED_OUT
活动态 -> CANCELLING -> CANCELLED
崩溃窗口或远端不可判定 -> UNKNOWN
UNKNOWN -> RUNNING | 任一真实终态 | ABANDONED(仅残余风险合同)
```

- Attempt 永不覆盖；retry 总是创建 `attemptNo + 1`。
- `ABANDONED` 需要 `ResidualExecutionRiskSpecification` 同时证明：Run=`CANCELLING`、Attempt=`UNKNOWN`、显式接受、无 PENDING/LEASED cancellation command，且有 cancellation effect 已开始或有效 reconciliation 证据。
- 有副作用的未知 Attempt 未经外部确认不得 abandon 后重试。
- Planner、Worker 和 Synthesizer 都使用 Attempt 记录，保证规划阶段和汇总阶段也可恢复。
- watcher 在 `waitForRun()` 和 transcript 读取等 await 后重新读取 Attempt/Run；`SUCCEEDED/FAILED/TIMED_OUT/CANCELLED` 只允许从精确预期状态/revision 原子提交，取消与完成只能有一个胜者，Evidence 只能由成功事务一起提交。
- `resolveUnknown` 必须携带精确 Attempt revision。解析为 `RUNNING` 且 Run 有 sticky cancel 时立即重新排队取消；解析为真实终态后必须继续尝试关闭 pending partial/cancellation。

### 4.6 Delivery 状态

V1 创建不可变 `FinalArtifact` 后，以精确 transcript 作为必需交付腿：

Portable Core 使用公开的 `appendAssistantMirrorMessageByIdentity()`，传入 `agentId + sessionKey + sessionId + idempotencyKey`。该 API 将 `sessionId` 作为 expected identity；返回 `session-rebound` 时不得改投当前同名 session。`chat.inject` 只有 sessionKey 语义，不能用于该交付契约。

```text
DeliveryStatus = PREPARED | SENDING | DELIVERED |
                 RETRY_REQUIRED | UNKNOWN | ABANDONED

transcriptStatus = PENDING | CONFIRMED | FAILED | UNKNOWN | SESSION_REBOUND
channelStatus    = NOT_REQUIRED | PENDING | CONFIRMED |
                   FAILED | UNSUPPORTED | UNKNOWN
requirement      = TRANSCRIPT | TRANSCRIPT_AND_CHANNEL
```

V1 默认且只正式支持 `requirement=TRANSCRIPT`。`TRANSCRIPT_AND_CHANNEL` 必须等严格渠道发送 API 通过单独 POC 后才能启用。

每次外部尝试创建不可变 `DeliveryAttempt`：

```text
SUBMITTING -> CONFIRMED
           -> FAILED
           -> UNKNOWN
```

完成规则：

- `transcriptStatus=CONFIRMED` 且 requirement 已满足，Delivery 才能 `DELIVERED`。
- `PREPARED/SENDING/RETRY_REQUIRED/UNKNOWN` 对应 Run `DELIVERY_PENDING`。
- `UNKNOWN` 只允许使用原 DeliveryAttempt、原 effect key 和原 target/artifact 做 create-or-get 对账；不得创建新 key，也不再要求用户接受重复投递风险。只有已知未交付的 `RETRY_REQUIRED` 才能创建新尝试。
- `SENDING` 与其 `SUBMITTING` DeliveryAttempt 对一次 transcript append 具有独占所有权；此时 retry、retarget 和 abandon 均被拒绝。`DELIVERY_PENDING` 不接受普通 Run cancel，必须显式 abandon idle Delivery。append 结果只能以 exact Delivery revision/status 和 effect key CAS 提交，迟到结果不能完成已替换目标。
- Delivery 确认与 Run 终态在同一事务提交；提交前重新计算全 Run recovery blockers。若仍有与本次 Delivery 无关的未解决 Intervention，Run 可以完成业务交付，但 `reconcileState` 必须保持 `ATTENTION_REQUIRED`，直到对应恢复事实被显式解决。
- “放弃交付并结束”把 Delivery 置为 `ABANDONED`，Run 经 `CANCELLING` 进入 `CANCELLED(reason=DELIVERY_ABANDONED)`；不能伪装成 `COMPLETED`。
- retarget 只允许 idle 的 `PREPARED/RETRY_REQUIRED/UNKNOWN`；在同一事务原子把旧 Delivery 置为 `ABANDONED`，再创建新的 target revision 和 DeliveryAttempt，保留旧目标及其失败记录。

### 4.7 Partial 完成算法

1. `run.partial.preview` 先由 `PartialDecisionSpecification` 校验非空、规范化的 logical id，再计算待 waive 节点、被阻塞后代、需要取消的活动 Attempt、风险和短期 confirmation token；当前 plan 的 `UNKNOWN` Attempt 也必须列入 active closure。
2. `run.partial.accept` 原子关闭调度闸门并写入用户决定。
3. 未运行且安全的选定节点进入 `WAIVED`；活动节点先进入 `CANCELLING`。
4. 所有相关 Attempt 确认终止后，pending waive 才正式生效。
5. 所有 current-plan required WorkItem 均为 `SUCCEEDED/WAIVED`，且全 Run 不存在 active/UNKNOWN Attempt 后进入 `SYNTHESIZING`；不相关的活动 Worker 也必须先结算。
6. 任一取消结果未知时停在 Intervention，不允许边汇总边留下旧 Agent 继续执行。
7. preview/accept 只允许 `AWAITING_INTERVENTION` 且没有 sticky cancel；Run cancel 获胜时把 pending decision 改为 `PARTIAL_SUPERSEDED`，禁止其稍后 waive、synthesize 或重开 Run。pending decision 同时阻断 WorkItem mutation 与 plan revise，并在事务内按 exact `planRevisionId` 二次校验。
8. `PartialApplicationPolicy` 在事务前后阻断 maintenance gate、未解决 session mutation 和 closure 外 Intervention；仅解决当前 plan closure 内的 Intervention，并在 waive 前再次断言全 Run recovery blockers 为空。腐坏 decision 产生的 `PARTIAL_DECISION_CORRUPT` 只能由新的显式 accept 精确关闭。
9. 若用户选择接受远端 Task 残余风险，先按 `ResidualExecutionRiskSpecification` 记录 decision/event/intervention，再允许本地取消收敛；该路径仍保持 `ATTENTION_REQUIRED`，不能被当作普通 partial 或 quiescent cancel。

---

## 5. 端到端业务流程

### 5.1 发起与原生身份确认

1. 用户从 Chat 中一条用户消息选择“发起协作”。
2. Desktop 确认该消息来自 `chat.history` 的当前 `sessionId`，并能按 `nativeMessageId/clientMessageId`重新读取。
3. Desktop 获取并校验 `RuntimeIdentity`。
4. Desktop 调用 `junqi.collab.capabilities`，确认 durable runtime、插件版本和 schema。
5. `plan.create` 携带完整 OriginRef。插件重新读取精确 transcript 并验证消息存在、角色为 user、session id 未变化。
6. 插件在一个事务中利用 partial unique index 创建 Run；存在活动 Run 时返回 `ACTIVE_RUN_EXISTS` 和已有 run id。

预检失败不创建半成品运行或任务图。

### 5.2 能力快照与指派授权

Portable Core 不能把 `agents.list` 当作插件内可调用的通用能力。CapabilitySnapshot 分层记录：

```text
configuredFacts      # Agent id/name/description/runtimeType/allowed/coordinator、coordinatorAgentId、allowedAgentIds、runtimeVersion
desktopObservedFacts # 仅 targetFingerprint/deploymentKind/persistence/gatewayVersion
runtimeProbeFacts    # 当前实现为空对象，预留给未来实际探测
source + capturedAt + configHash
```

规则：

- Desktop observed facts 只用于 UI 和规划提示，不能成为安全授权依据。
- 插件只指派同时存在于 OpenClaw config、插件 `allowedAgentIds` 和协调 Agent 允许策略中的 Agent。
- 技能或工具“已安装”不等于目标 Agent 在当前 session/channel 下必然可调用。
- 持久化前会移除 Agent `model` 对象，模型不会进入 snapshot 或 `configHash`；V1 因而不能仅凭该快照检测模型切换。
- 上述 configured facts 或其 `configHash` 在批准后变化时，停止新分派并进入 Intervention。
- 无 Agent、无协调 Agent或无授权 Worker 时拒绝规划，并返回可执行修复路径。

授权检查不是一次性计划校验。每条 Agent command 在可能产生外部效果前，service 必须在权威数据库事务中重新构建 effective authorization，并同时核对 Attempt 目标、当前配置/allowlist/协调 Agent policy 和已批准 capability hash。若授权被撤销或 hash 漂移，系统在同一事务把 command 与 Attempt 置为 `FAILED`、WorkItem 置为 `NEEDS_INTERVENTION`、Run 停止分派并进入 `AWAITING_INTERVENTION/ATTENTION_REQUIRED`，记录事件与 Intervention，且不安排自动 retry。`OpenClawRuntimeAdapter.runAgent()` 在真正调用 `subagent.run()` 前再次执行防御性校验，任何未来绕过 service 的路径也必须 fail closed。

### 5.3 规划

协调 Agent 输出严格 schema：

```text
goal
workItems[]:
  id, title, inputScope, dependencies, requiredCapabilities,
  candidateAgentIds, acceptanceCriteria, riskLevel, sideEffectClass
synthesis:
  requiredEvidence, finalAnswerContract
```

插件执行：

1. 为 Planner 创建 Attempt 和稳定 effect key。
2. 只传递原始目标、允许的上下文引用和能力快照，不默认复制全部会话。
3. 解析 JSON 并进行 schema、DAG、数量、深度、并发、Agent 授权和副作用校验。
4. 最多执行有界的格式修复；仍失败则创建 Intervention，不把自由文本当计划。
5. 保存不可变 PlanRevision，并返回目标、DAG、候选 Agent、风险和副作用预览。

### 5.4 计划批准

批准命令必须包含：

```text
runId
planRevisionId
expectedRunRevision
```

默认行为：

| 场景 | 行为 |
| --- | --- |
| 只读研究、分析、汇总 | 批准计划后自动分派 |
| 文件写入、命令执行、外部发送、数据删除 | 仍保留 OpenClaw 原生审批 |
| Agent、权限、输入范围或副作用改变 | 停止新分派并要求重批 |
| 高风险重试或未知副作用 | 必须人工确认 |

`CurrentPlanScopeRepository` 将“当前计划”作为显式聚合边界。`plan.revise` 不仅检查当前 WorkItem，还要在事务外预检并在同一写事务内复核整个 Run 的所有 PlanRevision，以及 Planner、Worker、Synthesizer 的全部活动或 `UNKNOWN` Attempt；只有全局 quiescent 才能切换 current plan pointer。所有 WorkItem mutation 必须断言目标属于当前计划；历史 revision 不会被改成 `WAIVED` 来伪造结算。若旧 Worker 或 Synthesizer 在修订后迟到完成，结果只作为 `ABANDONED`/事件审计保留，不能写 Evidence、FinalArtifact 或推进当前计划。

### 5.5 Provisioning 与正确的 Task 映射

批准后：

1. 以原会话创建一个 Managed Task Flow，保存 `runId/domainRevision` 的精简投影。
2. Managed Flow 只表示协作级 running/waiting/cancelled，不为 Worker 调用 `runTask()`。
3. 插件为 READY WorkItem 创建 Attempt 和 outbox command。
4. 按批准时冻结的 `runtimeType` 选择 Dispatcher：Native 调用 `api.runtime.subagent.run({ deliver:false, idempotencyKey })`；ACP 调用受信任 Gateway `tools.invoke({ name:"sessions_spawn", args:{ runtime:"acp", mode:"run", agentId, label } })`。
5. 严格校验返回的 `runId`；ACP 还必须校验 `status="accepted"`、真实 `childSessionKey` 和目标 Agent 所有权，并将真实 child key 写入 Attempt。
6. 插件使用 `runtime.tasks.runs.bindSession({ sessionKey: workerOwnerSessionKey }).list()` 按精确 runtime、owner、child session、run id、Task id 或 ACP deterministic label 查找 OpenClaw 自动创建的真实 Task，找到后补写 `openclawTaskId`。
7. OpenClaw 可能在内部创建自动 mirrored Flow，但当前公共 SDK 路径不暴露稳定 id；V1 不保存该 id，也不把它冒充协作 Managed Flow。

若第 4 步远端可能已启动但本地未拿到响应，Attempt/command 进入 `UNKNOWN`，Run 停止分派。后续只使用原 Attempt 的 idempotency key 对账；若外部身份在取消请求后才返回，先持久化 run/task ref，再立即取消真实 Task。

PROVISION 命令创建或恢复 controller-bound Managed Flow，但不能以 lease 次数猜测远端效果。每次执行先按 owner session 和精确 `controllerId=junqi-collab/{runId}` 查询 registry，adapter 返回封闭结果 `FOUND/ABSENT/AMBIGUOUS`：`FOUND` 进入 Specification 验证；`ABSENT` 只有在 Policy 仍允许 `CREATE_OR_RECOVER` 时才可写入 `effect_started_at` 后创建；`AMBIGUOUS` 必须 fail closed，禁止任取一个 Flow。创建返回值还必须能在 owner registry 中按同一 controller 查回，否则视为无效响应。

`ProvisionExecutionPolicy` 把运行阶段与基础设施 fence 组合成显式决定：仅 `PROVISIONING + unfenced` 可创建或恢复；`PROVISIONING + fenced` 持久 defer；`CANCELLING/COMPLETED/CANCELLED/FAILED` 一律 `OBSERVE_ONLY`。因此终态恢复可以观察并收敛已经存在的 Flow，但绝不补建新 Flow。共享 identity specification 校验 controller、run id、Flow id、状态、revision 与 domain revision；provisioning specification 只接受未申请取消的 running Flow；closure specification 允许在 provision revision 到当前 Run revision 的范围内核验关闭状态，并把冲突分类保存。

PROVISION 瞬时失败由 `FailureRetryPolicy` 按 `failure_count` 计算有界退避并写入 `available_at`；PROVISION 当前最多 3 次业务失败，backoff 为 1s/5s。达到上限后 command 进入 `FAILED`、Run 进入可见 Intervention。用户触发 `run.reconcile` 会以同一 command/effect key 清零失败预算并重试，保留 `attempts` lease 代际和 `effect_started_at`，不创建第二个 Flow。

取消时必须逐个取消真实执行 Task，再结束 Managed Flow；不能假设 Managed Flow 会取消未绑定的 Worker。Managed Flow 取消是两阶段协议：先以 `expectedRevision` 调用 `requestCancel()`，该步骤持久化 `cancelRequestedAt` 并把 revision 增加 1；再调用 `cancel()`。若第二步抛错，重试仍携带原 expected revision，adapter 识别 `cancelRequestedAt + revision=expected+1` 后直接继续第二步，不重复请求取消。只有 `found=true`、`cancelled=true` 且返回 Flow 的状态确为 `cancelled` 才确认成功。

### 5.6 分派、执行与结果验收

每个 Worker 只得到：

- WorkItem 目标和验收标准。
- 明确 `inputScope` 和必要上游 Evidence。
- run/workItem/attempt id。
- 输出 schema 和不可信数据边界。

Worker 输出：

```text
summary
outcome
evidence[]: type, title, reference, verification, warning
createdArtifacts[]
handoffNotes
```

插件按 Attempt runtime 监听终态：Native 使用 `runtime.subagent.waitForRun()`，ACP 使用官方 Gateway `agent.wait`；结果读取统一经过精确 transcript API（Native 使用 runtime session reader，ACP 使用 `session-transcript-runtime`）。定期 reconcile 仍是权威兜底。只有结构化结果通过验收，WorkItem 才进入 `SUCCEEDED`；运行成功但结果无效仍进入 `NEEDS_INTERVENTION`。

并发同时受以下限制：

- OpenClaw 全局和目标 Agent 限制。
- 本次 Run 并发预算。
- 依赖图。
- 插件 dispatch gate。
- 用户批准的 Agent 和副作用范围。

### 5.7 停止和恢复新分派

`run.dispatch.stop`：

1. 同一事务 CAS `dispatchState=STOPPED`，Run 进入 Intervention。
2. 撤销尚未 lease 的 dispatch command。
3. 已 lease 命令在外部调用前重新检查 gate，不能越过 STOPPED。
4. 已运行 Attempt 不被冻结，继续回报。

`run.dispatch.resume`：

1. 重新校验能力、批准版本和未解决 Intervention。
2. 有可执行节点时进入 `RUNNING + OPEN`。
3. 已满足汇总条件时直接进入 `SYNTHESIZING + CLOSED`。

UI 始终使用“停止新分派”，不能显示为“暂停”。

### 5.8 失败、重试、改派和取消

- 补充输入通过 `workItem.input.append` 只影响下一 Attempt。创建下一 Attempt 时绑定当时全部未消费 input ids，之后不再重复；原文为内部执行数据，保存在 `work_item_inputs` 并参与 v2 删除 digest，但不进入 run snapshot/JSON export；UI 只展示输入范围、结构化摘要和 digest，不回显原文。
- 改验收标准通过 `plan.revise` 创建新计划版本。
- `workItem.retry` 始终创建新 Attempt，不覆盖历史。
- 未知 Attempt 必须先 reconcile；不能通过改派掩盖仍可能运行的旧 Agent。
- Run cancel 首先关闭 dispatch gate，写入 sticky cancel intent，取消真实执行 Tasks，全部落入终态后才 `CANCELLED`。
- WorkItem cancel 同样要求 entity CAS；先停止新分派，随后取消该节点真实 Task并等待确认，不能以 UI 状态替代远端终止证据。
- Agent 删除或授权撤销不会静默换 Agent，而是停止新分派并等待用户决定。
- 若远端 Task 终止无法确认，普通路径停在 Intervention；只有用户明确接受 `ResidualExecutionRiskSpecification` 的路径才允许本地 `CANCELLED`，并持续暴露 `ATTENTION_REQUIRED`，不允许把它解释成远端已停止。

### 5.9 汇总与精确 transcript 交付

所有 required WorkItem 成功，或 partial 决定完成后：

1. 创建 Synthesizer Attempt，只传入裁剪后的 Evidence 包。
2. 验证 `finalAnswerContract`，生成不可变 FinalArtifact 和 digest。
3. 创建 Delivery，target revision 固定原 `agentId/sessionKey/sessionId`。
4. 调用 `appendAssistantMirrorMessageByIdentity()`，使用稳定 idempotency key 对 assistant mirror message 执行持久 create-or-get。该公开 helper 在 transcript 写事务内按 key 扫描，命中时返回原 messageId，不再追加。
5. 将成功 append result 的 messageId 作为 typed receipt；`readSessionTranscriptEvents()` 仅可用于诊断，因为公开返回类型为 `unknown[]` 且会全量读取，不能作为核心正确性边界。
6. 确认后发布 transcript update；JunQi 在线时实时显示，离线时重开 history 可见。
7. SQLite 写回确认后，Run 才能进入 `COMPLETED`。

Export 是并行的只读审计旁路。即使在 `DELIVERY_PENDING` 或 maintenance defer 期间，超大事件/产物导出失败也只把对应 `export_job` 标记为 `FAILED` 并返回；不能把 orchestration Run 改成 `AWAITING_INTERVENTION`，不能写入 `COMMAND_FAILED`，也不能改变 Delivery 的原 effect key。这样导出失败不会制造一个无法恢复的交付状态。

若进程在 transcript 已追加但 SQLite 未确认之间崩溃，恢复时使用数据库中原 DeliveryAttempt 的精确 session identity、不可变 artifact 和原 idempotency key 再次调用同一 create-or-get helper。命中原记录会返回原 messageId并补写确认；无法判定则保持 `DELIVERY_PENDING/UNKNOWN`，不得换 key。

发现 `sessionId` 已变化时返回 `SESSION_REBOUND`，禁止按相同 `sessionKey` 自动改投新会话。用户可以 retarget 到明确的新 session、导出或放弃交付。

### 5.10 Clone、归档与删除

- 不提供 `run.reset`。重新开始一律 `run.clone`，生成新 run id、能力快照和批准链；不复制 Attempt、Evidence、既有批准事实或 Delivery。
- `run.clone` 只对调用者提交的原始 write envelope 执行一次校验；继承的 goal/origin 不会被写回请求后重新计算 `payloadHash`。receipt source 精确绑定 `junqi.collab.run.clone`，响应返回 `sourceRunId`，新 Run 的事件流写入带同一 `sourceRunId` 的 `RUN_CLONED`。
- archive 只改变 `archiveState`，不改变执行状态；默认只允许终态 Run。
- delete 采用 preview + confirmation token + DeletionJob。若存在 `FAILED PROVISION/FLOW_SYNC`，preview 额外返回精确 `flowReconciliationBlocker`（command id/status、Flow id/revision、bounded diagnostic）；confirmation token 把这组证据与 Run revision/digest 一起绑定，任一字段变化都要求重新 preview。
- `RunDeletionPolicy` 是纯 application policy，分别评估 preview、explicit execution、retention 与 retry。`SATISFIED` 只表示该入口的规则满足；preview 成功不构成执行授权。若 witness 表示至少两条失败 Flow command，preview、显式执行和 retry 一律返回 `FLOW_RECONCILIATION_REQUIRED`，当前单证据 tombstone 不得授权或表示任意子集。
- UI 对带 Flow blocker 的删除执行三重确认：先取得服务端 preview；再填写非空放弃原因并单独勾选“永久放弃 Flow 对账”；最后勾选永久删除确认。缺少任一项都不能构造 DELETE 请求；服务端也独立复核，不信任 UI。
- Desktop ErrorCode 解析和 allowlist 必须保留 `FLOW_RECONCILIATION_REQUIRED`，不能降级成无结构字符串。Provider 使用纯 `collaborationActionPreviewRecovery()` 决策：DELETE 遇该错误、DELETE/PARTIAL 遇 `REVISION_CONFLICT` 或不可信的 `INVALID_ACTION_RESPONSE`，先废弃旧 preview/token，再刷新权威 Run；不得自动重放删除或 partial 决定。
- DELETE worker 在摘要计算前把 command lease 延长到有界长租约，并在 `BEGIN IMMEDIATE` 事务内、首次文件 rename 前再次以 `command id + lease owner + attempts` 做同代 CAS；随后先把受管 JSON rename 到 staging，再写 `PENDING` tombstone、级联删除 Run 并结算 job。事务回滚会恢复 staging 文件；commit 后才 purge，重启 recovery 可继续未完成的物理 cleanup。V1 没有附件清理或 Workboard 清理。
- delete retry 的 job/run/status identity 读取、旧状态 CAS、DELETE command/receipt 写入必须在同一 `BEGIN IMMEDIATE` 内完成；竞争 retry 只能有一个进入 `PENDING`，已删除 Run 的物理 purge 与 tombstone/job 最终 CAS 也在同一事务内完成，避免遗留不可恢复的 transient `PENDING`。
- 删除 cleanup 状态为 `PENDING/PARTIAL/COMPLETED`。`PARTIAL` 只表示逻辑删除和 tombstone 已经提交，但仍有一个或多个插件管理的 JSON 导出/staging 项待清理；已删除 Run 不得重新出现在运行列表，恢复任务继续物理清理。
- `FAILED` 表示逻辑删除尚未成功完成；仍有 Run 时可通过删除重试 RPC 恢复。逻辑删除已完成后，UI 通过 tombstone 而不是 Run 卡片展示 `PARTIAL` 和诊断；controller/recovery 继续重试物理清理。
- 默认删除不能绕过未完成的 Flow 对账，返回 `FLOW_RECONCILIATION_REQUIRED`。只有 token 仍绑定同一 blocker 且请求同时携带 `abandonFlowReconciliation=true` 与有界非空原因，删除事务才允许继续；无 blocker 时伪造 abandonment 参数同样拒绝。执行事务内的再次快照判定保证 request 接受后新增 blocker 仍会阻止 staging、tombstone 和 cascade。
- tombstone 记录 actor、删除时间、v2 content digest 和 cleanup 诊断。显式弃置还永久记录 `flow_reconciliation_command_id`、`openclaw_flow_id`、`openclaw_flow_revision`、`flow_reconciliation_diagnostic`、`flow_reconciliation_abandoned_at` 和 `flow_reconciliation_abandon_reason`；历史抽屉按一组完整证据校验并展示，不能把不完整字段伪装成审计事实。用户动作 actor 固定为 `operator`，保留清理固定为 `retention-policy`；公共插件 SDK 当前没有可验证的真实用户 principal，不能把 `operator` 描述成具体人名或账号。
- Run 删除不会立即删掉对应 command/deletion receipts；它们只用于 `retentionDays` 窗口内的幂等重放，窗口结束且 tombstone cleanup 完成后由 retention sweep 删除，tombstone 本身继续保留。
- 删除不会隐式删除原 Chat、OpenClaw Child transcript、Task/Flow。最近 500 条 tombstone 可由审计 RPC 和 Chat“协作记录”抽屉查看，但不包含已删除业务内容。
- 若 Run 因显式残余风险例外而 `CANCELLED + ATTENTION_REQUIRED`，clone、显式 delete、retention 和自动清理全部 fail closed，直到远端 Task 终止得到确认并关闭风险 Intervention；服务端 `allowedActions` 只保留导出和审计/归档相关动作。该风险审计不能被 tombstone 或 retention 静默抹除。

---

## 6. 恢复、一致性与维护

### 6.1 Reconcile 算法

插件启动、Gateway 恢复、显式 `run.reconcile` 和活动运行定时检查执行：

1. 加载所有非终态 Run 和未完成 command。
2. 读取对应 Managed Flow revision。
3. 按 Attempt 保存的 owner session、run id 和 task id 查询真实 Task。
4. 读取必要的 child transcript，验证结构化结果和 Evidence。
5. 按 target revision 和 idempotency key 检查 Delivery。
6. 对已确认副作用补写本地事件；对未知副作用创建 Intervention。
7. 使用实体 revision 做单调 CAS 更新。
8. 发布只读 snapshot revision 和 last event sequence。

终态 Managed Flow 镜像使用独立 `FLOW_SYNC` outbox。Run 终态迁移与对应 sync command 在同一 SQLite 事务中写入；启动时 `repairMissingTerminalFlowSyncCommands()` 还按批次原子补建旧崩溃窗口中缺失的终态 command。自动重试由 `FailureRetryPolicy` 按 `failure_count` 采用 1s/5s/30s/120s 退避，最多 5 次业务失败；lease reclaim 和基础设施 defer 不消耗这个预算。耗尽后 command 为 `FAILED`、Run 的 `reconcileState=ATTENTION_REQUIRED`，快照暴露 `RECONCILE`。用户显式 reconcile 重开同一个 command/effect key、清零失败预算；成功后才更新本地 Flow revision 并清除人工动作。

Attempt terminal completion 另有一层 phase-specific policy：Planner/Worker/Synthesizer 只能从其对应 active phase 结算，或从 `AWAITING_INTERVENTION` 且 `resume_status` 精确匹配的恢复态结算。maintenance lease 过期造成的 phase freeze 必须在事务内桥接回该 active phase；不匹配就保持 Intervention，不借助“任意非终态”宽松判断。Delivery transcript append 在外部效果前再次检查 maintenance，命中时持久 defer 原 command/effect，不消耗业务失败预算。

PROVISION 在 Run 关闭后只能观察：controller lookup 为 `ABSENT` 时结算为无 Flow 的 `CANCELLED` no-op；`FOUND` 时以 closure specification 核验。符合预期则记录 Flow identity/revision，并按 Run 的 `COMPLETED -> succeeded`、`CANCELLED/CANCELLING -> cancelled`、`FAILED -> failed` 收敛；controller、identity、domain revision、cancel intent 或 terminal status 冲突时，不覆盖或隐藏远端事实，而是把 PROVISION command 置为 `FAILED`、保存已核验的 Flow 引用、令 Run 进入 `ATTENTION_REQUIRED`、创建 Intervention 并暴露 `RECONCILE`。

活动 Run 的安全扫描不复用 UI 的 500 条展示页：controller 使用按不可变 id 的分页迭代直到耗尽。Maintenance 对外响应最多返回 100 条、且受 64 KiB 内预算约束的最小 Run 引用，同时单独返回 `activeRunCount` 和 `activeRunsTruncated`；是否允许维护必须依据真实 count/全量扫描，而不是截断数组长度。

任何恢复都不得从 UI 缓存、动画或 `runningSubAgents` 的超时推断真实状态。

### 6.2 故障矩阵

| 故障 | 控制器行为 | 用户可见结果 |
| --- | --- | --- |
| JunQi 窗口关闭 | Durable Gateway 继续；重开后 cursor replay | 运行不中断 |
| JunQi 应用退出且为 Managed Child | 启动前已阻止该模式 | 引导启用后台运行 |
| Gateway/插件重启 | `reconcileState=RUNNING`，SQLite + Flow + Tasks + transcript 对账 | 显示“正在恢复”后收敛 |
| WebSocket 事件丢失/乱序 | sequence 去重，缺口拉 snapshot | 状态不回退 |
| Worker timeout | Attempt `TIMED_OUT`，WorkItem intervention | 可重试/改派/partial |
| Task 查询不到 | 先进入 `UNKNOWN`，禁止重复分派 | 显示恢复动作 |
| Agent 删除/授权变化 | 停止新分派 | 不静默换人 |
| OpenClaw runtime 调用超过 operation deadline | 保存 `RUNTIME_TIMEOUT`；有潜在副作用时进入 UNKNOWN 对账 | 不无限挂起、不盲重发 |
| 原 session reset/delete | `SESSION_REBOUND` 或 Intervention | retarget/导出/放弃 |
| Delivery 状态不确定 | 查询 exact transcript idempotency key | 不自动重复写入 |
| Workboard | V1 固定 `supported: false`，没有镜像副作用 | 核心运行不依赖它 |
| 磁盘满/SQLite 错误 | 停止新副作用，保留诊断 | 不假装已保存 |
| OpenClaw Task/Flow 已按原生保留策略清理 | 使用插件结构化归档 | 在 JSON 导出容量合同内仍可导出；超限任务明确失败 |

### 6.3 存储迁移和 OpenClaw 更新

Tauri 执行存储迁移或 OpenClaw/插件更新前必须持有 maintenance lease：

1. `maintenance.enter(reason, owner)` 关闭全局新分派并返回 45 分钟期限的 `maintenanceLeaseId`；Desktop 在实际维护调用前重新读取权威状态并要求至少剩余 37 分钟（30 分钟给 package/fallback，5 分钟给 Gateway 恢复和最终版本核验，2 分钟给 IPC、回连验证和精确 lease release）。普通完成不会释放 `EXPIRED` lease，必须走显式 recovery。
2. 列出活动 Run，由用户选择等待、取消或放弃维护。
3. 等待全部外部副作用 settled，未知状态阻止自动维护。
4. 插件 checkpoint SQLite 并返回数据库/instance/schema digest。
5. Supervisor 确认真正目标 Gateway 已停止；任何停止失败都中止复制。
6. 使用 SQLite backup/一致快照迁移，并在目标执行 integrity check。
7. 重启后校验 OpenClaw、插件、instance 和 schema，执行 reconcile。
8. 健康检查失败时恢复 OpenClaw/插件版本和配置；协作数据库不被静默降级。
9. `maintenance.exit(leaseId, owner)` 只在全部检查通过且插件 Repository 对 lease id 与稳定 Desktop owner 同时 CAS 匹配后重新开放分派；释放全局 gate 不自动 resume 任一 Run。
10. Desktop 崩溃导致 lease 过期时，插件以 SQLite compare-and-set 将 ACTIVE 转为 EXPIRED，保持调度关闭，并为每个活动 Run 幂等写入一次 `MAINTENANCE_LEASE_EXPIRED` 事件与 Intervention、关闭已排队 command；重复 status/capabilities/restart 不得复制诊断。
11. lease JSON 损坏、字段越界或 owner 不匹配时一律 fail closed；不得删除损坏事实或凭本地时间自动开放。恢复必须由明确的维护修复路径和精确 owner 完成。
12. 维护恢复完成后，terminal attempt/delivery worker 仍必须重新读取 gate、command lease 和实体 revision；旧快照不能直接完成终态或发送 transcript。

存储迁移补充采用同一事务原则：冷启动可达 Gateway 必须先通过 SystemService/Docker owner attestation；External 或未归属 listener 不可被迁移流程停止。ManagedChild、Docker、SystemService 按原 owner 分支停止，子进程/容器/服务均须确认端口释放；staging copy 具备 RAII 清理、物理路径 overlap/symlink 防护和严格 workspace config patch。bootstrap 切换或恢复失败统一执行候选运行时停止、旧 bootstrap 恢复、原 owner 恢复和再次 attestation，任一补偿失败都保留 `Error` 并要求显式 recovery。

V1 的 Rust updater 使用一个 monotonic absolute deadline 覆盖 detect-before、registry probe、Gateway stop、package update、service/managed restart、restore 和 post-update re-detect；package/fallback 共用 30 分钟预算，并保留 5 分钟 Gateway 恢复/最终核验余量。mutation 前必须满足 owner/owned-child 组合不变量；ManagedChild/SystemService 全窗口由 RAII restart flag/generation 防止状态轮询改写 owner 或排队 restart 二次执行。ManagedChild 只有在旧进程已回收且端口释放后才能重启；更新命令以 Unix 进程组或 Windows 有界进程树终止封住包管理器后代。System Service 的恢复必须通过 `gateway status --json --require-rpc`，并交叉核验 daemon config、service environment、supervised/listener PID、端口和 RPC/CLI/Gateway 版本，TCP liveness 本身不是 owner 证明。普通 start/restart/stop/ensure 复用同一 owner/child fence；从 SystemService/External 自动转 ManagedChild 或 Docker 在未完成 owner-specific stop/inactive attestation 时直接拒绝，避免端口空闲 TOCTOU。Managed fallback 超时会先终止、回收 child 并确认端口释放，不把失败事实伪装回 SystemService。该实现不是 lease renewal，也不替代外围 Tauri 调用的进程级 watchdog；若任何外围阶段仍越界，lease 会进入 `EXPIRED` 并保持调度关闭，普通完成路径拒绝释放，必须显式 recovery。该 fail-closed 行为已有自动化覆盖，但全链路长时可用性仍属于 24 小时 fault/soak 门禁。

---

## 7. Gateway RPC 与事件契约

### 7.1 Read RPC

| 方法 | Scope | 用途 |
| --- | --- | --- |
| `junqi.collab.capabilities` | `operator.read` | runtime/plugin/schema/capability 健康信息 |
| `junqi.collab.plan.get` | `operator.read` | 获取精确计划版本 |
| `junqi.collab.run.get` | `operator.read` | 获取完整运行快照和 allowed actions |
| `junqi.collab.run.list` | `operator.read` | 跨会话读取尚未删除的活动/历史运行 |
| `junqi.collab.run.listBySession` | `operator.read` | 按 `sessionKey + sessionId` 读取 |
| `junqi.collab.tombstone.list` | `operator.read` | 按删除时间倒序读取最近审计 tombstone；默认 100、范围 1..500 |
| `junqi.collab.events.list` | `operator.read` | `afterSequence` 分页补洞 |
| `junqi.collab.run.partial.preview` | `operator.read` | 计算 partial 闭包和 token |
| `junqi.collab.run.delete.preview` | `operator.read` | 删除影响和 token |
| `junqi.collab.run.delete.get` | `operator.read` | 删除任务状态 |
| `junqi.collab.session.mutationImpact` | `operator.read` | 预览 reset/delete 对活动运行的影响 |
| `junqi.collab.export.get` | `operator.read` | 导出任务状态/元数据 |
| `junqi.collab.export.download` | `operator.read` | 下载已生成导出物 |
| `junqi.collab.maintenance.status` | `operator.read` | 维护闸门和活动运行 |

### 7.2 Write RPC

| 方法 | 用途 |
| --- | --- |
| `junqi.collab.plan.create` | 验证 OriginRef 并创建规划运行 |
| `junqi.collab.plan.revise` | 创建不可变新计划版本 |
| `junqi.collab.plan.approve` | 批准精确版本 |
| `junqi.collab.run.dispatch.stop` | 停止新分派 |
| `junqi.collab.run.dispatch.resume` | 校验后恢复新分派 |
| `junqi.collab.run.partial.accept` | 接受 preview 中的缺失闭包 |
| `junqi.collab.run.cancel` | 取消整个运行 |
| `junqi.collab.run.reconcile` | 显式状态对账 |
| `junqi.collab.run.clone` | 克隆为新草稿运行 |
| `junqi.collab.run.archive/unarchive` | 改变归档状态 |
| `junqi.collab.run.delete` | 创建删除任务 |
| `junqi.collab.run.delete.retry` | 重试部分删除 |
| `junqi.collab.workItem.input.append` | 追加下一 Attempt 输入 |
| `junqi.collab.workItem.reassign` | 改派无活动 Attempt 的节点 |
| `junqi.collab.workItem.retry` | 创建新 Attempt |
| `junqi.collab.workItem.cancel` | 取消节点及活动 Attempt |
| `junqi.collab.attempt.resolveUnknown` | 高风险未知状态处理 |
| `junqi.collab.delivery.retry` | 新建 DeliveryAttempt |
| `junqi.collab.delivery.retarget` | 创建新目标 revision |
| `junqi.collab.delivery.abandon` | 放弃交付并取消运行 |
| `junqi.collab.session.mutation.prepare` | 建立 session reset/delete 变更栅栏 |
| `junqi.collab.session.mutation.complete` | 记录 core session RPC 结果并释放栅栏 |
| `junqi.collab.export.create` | 创建带审计记录的导出 |
| `junqi.collab.maintenance.enter/exit` | 维护模式切换 |

Write RPC 默认要求 `operator.write`；插件安装、配置和 runtime 管理不走这些 RPC，而由 Tauri Supervisor 的显式高权限路径负责。

写操作产生的领域 `actor` 当前只能可靠区分 `operator` 和 `retention-policy`。RPC scope 证明请求具备操作权限，但公共插件 SDK 没有提供可验证的真实用户 principal；审计 UI 和导出不得把 `operator` 推断为某个具体登录用户。

### 7.3 命令、CAS 与响应

所有写请求共同携带：

```text
commandId
payloadHash
expectedCollaborationInstanceId
```

按操作语义再携带 `expectedRunRevision`、`currentPlanRevisionId` 和局部实体命令的 `expectedEntityRevision`；它们不是 `plan.create`、maintenance 等无对应 Run/实体操作的伪前置条件。

`expectedCollaborationInstanceId` 是 plugin `0.3.0` 起所有写操作的必填字段，并参与 canonical payload hash。插件必须在任何领域 mutation、receipt 创建或 session/maintenance 副作用前与数据库权威实例精确比较；`plan.create`/`run.clone` 的 origin runtime id 只绑定权威实例，不能信任客户端自报值。该变更是有意的 breaking wire contract：旧 `0.2.x` envelope 直接拒绝，Desktop 不自动把已排队写请求改绑到新发现的实例。

插件派生外部 effect key：

```text
collab:{runId}:plan:{planRevisionId}:work:{workItemId}:attempt:{attemptNo}
collab:{runId}:delivery:{deliveryId}:attempt:{attemptNo}
```

所有写响应共同返回：

```text
accepted
replayed
commandId
collaborationInstanceId
```

存在对应领域对象时再返回 `runId`、`newRunRevision`、`newEntityRevision`、`lastEventSequence` 等操作结果。

首次执行与 receipt replay 都必须返回真实 `collaborationInstanceId`；Desktop wire codec 要求它与请求中的 expected id 完全一致，否则按 `INSTANCE_MISMATCH` fail closed。`run.clone` 另外返回 `sourceRunId`；该字段和新 Run 的 `RUN_CLONED` 事件共同形成克隆来源的可追溯证据。

RPC 快速受理，长时间 Planner/Worker/Delivery 由异步 command 推进，不能占用 Desktop 默认请求超时等待完成。WorkItem、Attempt 和 Delivery 局部写命令必须携带并校验 `expectedEntityRevision`；服务端状态变化后前端刷新快照，不使用旧 revision 自动重放。

会持久化为 receipt 的 maintenance/session mutation 响应使用最小 `activeRunReference`，只包含 run id、状态/revision、必要 origin identity、当前 plan revision 和时间；不写入 goal、capability snapshot、计划内容、Evidence 或 transcript。`maintenance.enter/exit` 和 `SESSION_MUTATION:PREPARE/COMPLETE` 同样受 source 绑定与 unscoped 10,000 条容量约束。

稳定错误码至少包括：

```text
REVISION_CONFLICT
INVALID_TRANSITION
IDEMPOTENCY_CONFLICT
ACTIVE_RUN_EXISTS
ACTIVE_ATTEMPT_EXISTS
CAPABILITY_CHANGED
RUNTIME_NOT_DURABLE
INSTANCE_MISMATCH
ORIGIN_NOT_DURABLE
SESSION_IDENTITY_MISMATCH
PARTIAL_CLOSURE_REQUIRED
DELIVERY_UNKNOWN
DELETE_REQUIRES_TERMINAL
FLOW_RECONCILIATION_REQUIRED
MAINTENANCE_ACTIVE
```

前端遇到 revision conflict 只刷新快照，不自动重放用户决定。DELETE/PARTIAL 的 preview 还必须先失效；DELETE 遇 `FLOW_RECONCILIATION_REQUIRED` 同样失效 preview 并刷新，让用户基于新的 blocker 重新完成确认。

### 7.4 事件一致性

事件推送只作为刷新提示：

```text
junqi-collab.changed {
  collaborationInstanceId,
  runId,
  runRevision,
  lastSequence
}
```

真实恢复流程：

1. 连接后先校验 instance id。
2. 拉取 `run.listBySession(sessionKey, sessionId)` 和全局活动运行。
3. 对已知 Run 调用 `events.list(afterSequence)`。
4. sequence 有缺口、事件已清理或 snapshot revision 不匹配时，重新 `run.get`。
5. 插件事件推送能力未通过 POC 时，活动 Run 使用短周期 polling；正确性不依赖 push。

`run.list` 使用 opaque cursor v2：排序键为不可变 `(created_at, id)`，首屏固定 snapshot upper bound，cursor 同时绑定 `activeOnly/includeArchived` 过滤条件并限制为 canonical、最多 512 decoded bytes。客户端必须把全部页聚合完成，再按展示需要以 `updatedAt DESC, runId DESC` 排序；不能把可变 `updatedAt` 当服务端翻页边界。前端最多物化 10,000 条，重复 cursor、越界或不规范 cursor 一律 fail closed，不提交半页历史。

---

## 8. Chat UI 投影

### 8.1 数据结构

协作卡不能伪装成 ChatMessage。前端增加：

```text
ChatTimelineItem = ResponseGroup | CollaborationAnchor

CollaborationAnchor {
  runId,
  originSessionId,
  originNativeMessageId,
  snapshotRevision
}
```

`CollaborationStore` 独立保存 snapshot/events/command state，再按原生 OriginRef 与 Chat timeline 做 sidecar join。history 刷新、分页和本地 RenderBlock 重算不能删除协作状态。可见投影必须同时满足：Gateway 已连接、RuntimeIdentity 已验证、当前 `connectionId` 等于投影绑定连接、`runtimeId` 等于插件 `collaborationInstanceId`；任一条件失效时立即隐藏并清空连接域 UI。

Store 使用单调 `projectionEpoch`、bootstrap/session/tombstone request generation 和 instance id 校验抵御连接 ABA：disconnect、instance swap 或显式 reset 会提升 epoch、停止 polling、清除 in-flight 去重表和缓存；旧连接晚到的 list/snapshot/events/tombstone 结果不能重新写入新投影。Push 只作提示，仍由当前实例的 RPC 快照校验。

### 8.2 紧凑卡

```text
协作运行 · 进行中 · 2 / 4

风险核查      Agent A   已完成
交付评估      Agent B   运行中
方案汇总      主 Agent  等待依赖

[展开图谱] [停止新分派] [取消]
```

UI 只渲染服务端 `allowedActions[]`：

| 场景 | 主要动作 |
| --- | --- |
| 待批准 | 查看/修改计划、开始、取消 |
| 运行中 | 展开、停止新分派、取消 |
| 人工介入 | 查看原因、补输入、改派、重试、partial、取消 |
| 交付待处理 | 对账、重试、retarget、导出、放弃交付 |
| 终态 | 时间线、证据、导出、克隆、归档、删除 |
| 本地已取消但远端 Task 未确认 | 显示持续风险提示、查看审计、导出、归档；隐藏克隆、删除和 retention 相关动作 |

### 8.3 展开与历史入口

展开视图显示：

- DAG、Agent、风险和真实状态。
- 计划版本 diff 和批准链。
- WorkItem `inputScope`、结构化摘要/digest、Attempt、可用的 OpenClaw run/task/session key 引用和 Evidence；不回显或导出 `work_item_inputs` 原文，也不声称拥有 child `sessionId`。
- Intervention、用户决定、恢复诊断和 Delivery target revision。
- 若存在 `ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK`，卡片和详情顶部固定显示“JunQi 已本地取消，但 OpenClaw Task 终止未确认”，同时展示远端 run/task、owner/child session、接受风险的 actor/time 和审计入口。该提示只有对应 Intervention 被服务端解决后才消失，不能由前端本地状态覆盖。
- 事件时间线与导出。事件分页只在游标完整推进时标记 `complete=true`；server 报告 cursor invalid、事件清理缺口或达到客户端页数上限时，保留 `incompleteReason`、刷新权威 snapshot，并在详情页明确显示“审计时间线不完整”，不得把当前可见事件冒充完整审计记录。

若 origin message 未加载、已 reset 或 session 已删除，Chat 顶部显示活动运行 banner。Chat header 提供“协作记录”抽屉：使用 `run.list` 访问跨会话归档，另拉取 `tombstone.list({ limit: 500 })` 展示最近删除记录的 run id、actor、删除时间、digest、cleanup 状态/诊断，以及存在时完整的 Flow reconciliation abandonment 证据；实例变化或断开连接时清空旧缓存。抽屉不显示已删除业务内容，也不新增一级主导航。

现有 `/agents/live` 只保留为 OpenClaw Subagent 观察页，不参与协作状态推断和控制。

### 8.4 Session reset/delete

JunQi 发起 reset/delete 时使用 `sessionMutationCoordinator`：

1. 调用 `session.mutationImpact(sessionKey, sessionId, action)` 展示影响。
2. 用户确认策略后调用 `session.mutation.prepare`，建立有期限的变更栅栏；栅栏期间该原生 session 不能创建新 Run 或新分派。
3. 按用户策略取消并等待活动运行，或把运行置为停止新分派并等待后续 retarget/export。
4. delete 只有 prepare 成功后才调用 OpenClaw core RPC，并携带 `expectedSessionId`；Desktop 还必须验证非空对象、成功标记、返回 `key` 与请求 session key 完全一致，以及 delete 的 `deleted=true`。
5. reset 使用官方 `sessions.reset`；协作层负责先完成 active Run 的影响分析、确认和必要的取消/等待，但不把未公开的 `SESSION_RESET_CAS` 当作 reset 的前提。
6. 只有 core RPC 返回上述可验证结果后才清理 Desktop 本地 Chat 状态；`deleted=false`、空响应、错误响应或 key 漂移都保持本地状态和附件不变。
7. 最后调用 `session.mutation.complete` 记录成功/失败并释放栅栏；Desktop 崩溃时由 lease expiry 和 reconcile 接管。

当 `junqi.collab.capabilities` 明确返回精确 `METHOD_NOT_FOUND` 时，session reset/delete 回到 OpenClaw 官方 Gateway `sessions.reset/delete` 路径；连接错误、无效 capability 响应或非精确缺失均不得降级。独立 Tauri absence proof 仅适用于受控维护路径：仍须同时绑定当前 verified `targetFingerprint` 和 `connectionId`，检查插件未安装、无 busy/recovery，且 `<local_state_dir>/junqi-collab` durable state 为 `absent`；目录存在、符号链接、损坏或检查未知均拒绝。proof 只有 30 秒 TTL，维护效果执行前必须再次探测。

用户界面提供：

1. 取消协作并等待结束后继续。
2. delete 或 reset 时，可保留运行但停止新分派，最终通过协作记录处理 retarget/导出。
3. 返回。

来自其他 OpenClaw 客户端的 reset/delete 由插件 session lifecycle hook 检测。旧 Run 仍绑定旧 `sessionId`；新 sessionId 可以创建自己的 Run，不会被相同 sessionKey 的旧 Run 阻塞，也不会自动继承旧 Delivery。

---

## 9. Workboard 未来边界

Workboard 不属于 V1：Portable Core 固定返回 `supported: false`，schema 12 没有 mirror 表，插件没有 `workboard.*` 调用、镜像 outbox 或补同步实现。UI 只能显示“不支持”，不能把缺失能力包装成降级镜像。

未来若 OpenClaw 公开并报告受支持的 official capability，需要单独设计、实现和验收以下合同后才能启用：只镜像不 dispatch、独立 mirror revision、幂等补同步、故障不改变核心 Run/Attempt，以及 Desktop 永不直接双写。本节不构成当前能力或发布时间承诺。

---

## 10. 实施阶段与硬门槛

### 阶段 0：运行时 POC

以下全部是发布门槛，不是普通单元测试项。为避免把 mock/合约测试冒充真实 OpenClaw 验收，本节 checkbox 只在隔离的真实 Gateway 上通过后勾选：

2026-07-17 的早期本地 `gateway run --dev` 探针即使设置临时 `OPENCLAW_STATE_DIR/OPENCLAW_CONFIG_PATH`，仍访问了用户默认 `~/.openclaw`，因此该方法继续被判定为非隔离。上一版 `bea9b0ac...` 包已在官方 OpenClaw `2026.7.1` 固定镜像和完整隔离环境中完成 structural P0-01 与 payload-free behavioral P0-02/03/05/06/07/08；当前 `62fa1fca...` 包尚未重跑，所有真实 Gateway 门禁均不能勾选。

- [x] `P0-01` 普通外部插件可注册 `junqi.collab.*` RPC、service 和 SQLite，不依赖 trusted-only runtime；当前 structural evidence 已通过。
- [x] `P0-02` `chat.history` 的 `sessionId/messageId/idempotencyKey` 可稳定建立 OriginRef；当前 behavioral evidence 已通过。
- [x] `P0-03` exact transcript append 使用 `agentId/sessionKey/sessionId/idempotencyKey`，重复执行只出现一条消息；当前 behavioral evidence 已通过。
- [ ] `P0-04` session reset 竞态不会写入新的 session；返回可判定的 rebound/mismatch。官方 Gateway reset 路径无需假设未公开 CAS，但仍须真实 Gateway 验证其会话重绑定语义。
- [x] `P0-05` 一个 `subagent.run()`只出现一个真实执行 Task；不调用 `managedFlows.runTask()`；当前 behavioral evidence 已通过。
- [x] `P0-06` 插件重启后可按 owner session + 确定性 child session key 找回唯一 Task 及 run id；零匹配或多匹配均 fail closed，且不依赖公共 SDK 未暴露的 child session id；当前 behavioral evidence 已通过。
- [x] `P0-07` 取消 Run 后所有真实执行 Task 均确认终止，无遗留 Worker；当前 behavioral evidence 已通过。
- [x] `P0-08` Gateway 重启时不会因重复 command 或事件产生第二次分派；当前 behavioral evidence 已通过。
- [ ] `P0-09` JunQi 关闭期间，System Service/Docker/External Gateway 仍可执行并写入原 transcript。
- [ ] `P0-10` Managed Child 被准确识别并阻止启动 durable collaboration。
- [ ] `P0-11` 普通外部插件核心流程完整运行，同时证明 trusted-only Gateway request 被禁用。
- [ ] `P0-12` V1 在真实 Gateway 上报告 Workboard `supported: false`，且核心结果不依赖 Workboard。
- [ ] `P0-13` reset/delete 的 session identity 能力分别探测；JunQi 只将官方公开的 Gateway session contract 作为跨版本依赖，协作层的 active Run 协调不得假设 reset CAS 存在。
- [ ] `P0-14` collaboration RPC 缺失时，session reset/delete 必须回到官方 Gateway 路径；maintenance 的 absence proof 仍须保持 exact target/connection、durable state 与 use-point re-probe 的独立真实 Desktop/Tauri 证据。

任一未通过项继续阻断生产发布；实现和测试可以继续推进，但不得据此把后续阶段的源码完成解释为发布准入完成。

### 阶段 1：JunQi 安全与运行基础

- [x] 保存并发送原生 session/message/client identities。
- [x] Gateway token 移出 localStorage。
- [x] Chat/Collaboration 与 admin 权限路径分离。
- [x] RuntimeIdentity 和 active Gateway 实例确认。
- [x] System Service / persistent Docker durable prerequisite。
- [x] Tauri Bootstrap Supervisor 的 install/update/rollback/health。
- [x] storage/update maintenance gate。

### 阶段 2：Collaboration Plugin

- [x] schema migration、partial unique index、完整性检查。
- [x] domain/Attempt recovery State Machine、interventions、entity revision。
- [x] Durable Outbox、`attempts` lease generation / `failure_count` 失败预算分离、`available_at` FailureRetryPolicy、`effect_started_at` 外部效果意图、lease/CAS、Command Result Committer、nested SAVEPOINT、PromiseLike transaction guard 和 uncertain recovery。
- [x] Lifecycle Supervisor 统一拥有后台任务、定时器、AbortSignal 和 shutdown drain。
- [x] Runtime Deadline Strategy/Decorator 覆盖 Flow、Agent、Task、Session、cancel 和 transcript await；timeout 清理 timer、吸收迟到结果，并保留 UNKNOWN/effect-key 恢复语义。
- [x] Effective Agent Authorization Specification 的 pre-effect fence 与 adapter defense，授权撤销或 capability hash 漂移时不调用 runtime。
- [x] `expectedCollaborationInstanceId` 写实例围栏、canonical payload hash 和 response/replay `collaborationInstanceId` 对称验证；`0.3.0` 明确拒绝旧 wire envelope。
- [x] `CurrentPlanScopeRepository` 统一 current-plan 聚合；全 revision/全 Attempt kind quiescence、历史 WorkItem mutation 拒绝和迟到 completion abandonment。
- [x] `SettlementSpecification` 统一 required settlement、partial closure 和全 Run active/UNKNOWN quiescence；terminal transition 与 synthesis enqueue 采用 defense-in-depth。
- [x] `WorkerPhaseRestorationPolicy` 保留显式 stop、partial、maintenance 和 session mutation phase fence；迟到 Worker 结果不能擦除 `DISPATCH_RESUME` 入口。
- [x] `PartialDecisionSpecification` 约束非空 logical-id 选择、exact plan revision 和 pending 期间的 WorkItem/plan 写栅栏；UNKNOWN Attempt 纳入 active closure。
- [x] Maintenance Lease Specification/Repository 的 ACTIVE/EXPIRED/MALFORMED fail-closed CAS 恢复、幂等 Intervention 和精确 owner 释放。
- [x] `TerminalAttemptCompletionPolicy` 精确桥接 maintenance 后的 Planner/Worker/Synthesizer terminal result；Delivery pre-effect maintenance fence 使用原 effect key defer。
- [x] sticky cancel、Attempt 终态 CAS、partial supersede 和 Delivery submission ownership。
- [x] 外部命令 receipt 的精确 operation 绑定、4,096 普通上限和 64 条终止恢复保留区。
- [x] Planner/Worker/Synthesizer Attempt。
- [x] Managed Flow 聚合镜像、controller `FOUND/ABSENT/AMBIGUOUS` lookup、ProvisionExecutionPolicy、provisioning/closure specifications、终态 observe-only、两阶段 Flow cancel、终态 sync 原子修复、PROVISION/FLOW_SYNC 自动退避与人工 reconcile，以及真实 Subagent Task adapter。
- [x] WorkItem 一次性补充输入、真实 Task 取消和 Attempt UNKNOWN 对账。
- [x] exact transcript Delivery、retarget、archive/delete/export，以及 Flow reconciliation abandonment 的 token 证据绑定、三重 UI 确认和 tombstone 审计字段。
- [x] Export sidecar failure isolation；`ResidualExecutionRiskSpecification` 的受控本地取消例外、审计 Intervention、clone/delete/retention fail-closed 和 late-result fence。
- [x] Attempt-level `canAbandonWithResidualRisk` projection 与旧 wire 缺省 false 的 fail-closed UI action gating。
- [x] capabilities、RPC、events cursor、不可变 history cursor、全量 active scan 和有界 maintenance snapshot。
- [x] `run.clone` 原始 envelope 单次校验、`sourceRunId` 和 `RUN_CLONED` 追踪。

### 阶段 3：JunQi Chat UI

- [x] CollaborationStore、精确 connection/runtime 投影、projection epoch ABA fencing 和 reconnect replay。
- [x] ChatTimeline sidecar anchor。
- [x] 计划确认、活动卡、图谱、带不完整状态的审计时间线、Evidence 和 Intervention。
- [x] stop dispatch、WorkItem input/cancel、partial、unknown、delivery、clone/archive/delete 全动作和 entity CAS。
- [x] session reset/delete 保护与全局协作记录抽屉。
- [x] 无 Agent、插件缺失、runtime 不持久、实例切换和版本不兼容引导。

### 阶段 4：Workboard

V1 Portable Core 明确返回 `supported: false`；本阶段是后续 trusted integration，不是当前发布阻断项。

- [ ] 检测真实 trusted integration capability。
- [ ] 仅镜像，不 dispatch。
- [ ] 幂等补同步、禁用/故障降级和升级兼容。

### 阶段 5：质量与发布

- [x] 插件 `0.3.0` / schema 12 canonical 自动化回归已通过：2026-07-20 plugin 364/364、Desktop 1157/1157、辅助脚本 207/207、Rust 534/534；package contract、Desktop TypeScript 与 production build 通过。
- [x] 当前 bundle metadata/Tauri resource parity 通过：155 个文件，SHA-256 `62fa1fcacf338b7f4e735f2726b999f4640a5db5de3f2f0fbfe492e11dc6c6fe`。
- [ ] 用当前 `62fa1fca...` bundle 重跑真实 Gateway structural 与适用 behavioral evidence；上一版 `bea9b0ac...` evidence 仅作历史记录。P0-04/09/10/11/12/13/14、视觉和 soak 仍开放。
- [ ] OpenClaw/插件/JunQi 三方兼容矩阵。
- [ ] 执行第 0.6 节的可维护验证命令，并把结果保存到当次 CI/发布记录。
- [ ] 在可用浏览器环境完成 Chat 协作工作台的桌面/移动视觉与交互 QA。
- [ ] 在隔离真实 Gateway 完成全部 P0 门槛。
- [ ] 完成长时间运行、重启/故障注入和安全 soak test。
- [x] 以远端 `main@1956f23` / `1.2.27` 完成三方整合，合并提交为 `5aa8901`。
- [ ] 闭环可信 promotion、仓库保护和 updater 签名资产合同；完成前 `release.yml` 保持 candidate-only。

---

## 11. 测试策略

| 层级 | 必测内容 |
| --- | --- |
| 单元 | 全部状态迁移、partial closure、DAG、权限、CAS、序列化白名单 |
| 属性 | DAG 无环；重复 command 不产生第二个 effect；终态不回退 |
| 合约 | 每个 RPC、错误码、OpenClaw 版本 capability、transcript append result |
| 集成 | Planner、Subagent Task mapping、取消、汇总、交付、retarget、删除 |
| 恢复 | 在规划、dispatch、运行、partial、cancel、delivery 各崩溃窗口重启 |
| 前端 | history refresh 后 anchor 不丢；session 切换不串；cursor gap 拉 snapshot |
| 安全 | token 不进入 browser storage；read/write 连接没有 admin；Agent allowlist |
| 生命周期 | System Service/Docker/External/Managed Child；存储迁移；OpenClaw 更新 |
| E2E | 无 Agent、单 Agent、多 Agent、权限不足、审批拒绝、部分失败、交付未知 |
| 混沌 | 重复/乱序/丢失事件、网络短断、磁盘满、Agent 删除、Task 清理 |

重点回归用例：

1. Chat optimistic id 与 native id 不再混用。
2. reset 后旧 Run 不附着到新 sessionId。
3. Worker 只产生一个执行 Task，不出现 Managed/automatic 双 Task。
4. stop dispatch 后任何已 lease 但未执行命令都不能越过闸门。
5. unknown side effect 未解决前不能 retry。
6. partial 必须等待活动 Attempt 全部确认停止。
7. transcript 已写但 SQLite 未确认时，重启能补写而不重复消息。
8. session 删除后，只要 Run 尚未删除且满足容量合同，仍能从全局协作记录导出结果；超限任务稳定进入 `FAILED` 并返回诊断。
9. Workboard capability 固定不支持，不改变核心 Run outcome，也不产生镜像命令。
10. 更新或迁移期间不能产生新分派。
11. clone 对原始 envelope 只校验一次，receipt operation、响应和 `RUN_CLONED` 都能追溯同一个 source Run。
12. 普通 receipt 达到 4,096 条后仍可执行终止恢复命令，额外 64 条用完后确定性返回容量错误。
13. Native `runtime.subagent.run()` 或 ACP `sessions_spawn` 响应丢失后只对账原 Attempt/idempotency key，不创建替代执行；ACP 不依赖 Gateway tools.invoke 的伪幂等重放，而是用 Task label 唯一对账，零条或多条都保持 UNKNOWN。
14. Attempt 完成/取消竞态只留下一个终态，Evidence 与成功事务一致。
15. Run cancel 会把 pending partial 标成 `PARTIAL_SUPERSEDED`，不能继续 waive/synthesize。
16. Delivery `SENDING` 时 retry/retarget/abandon/cancel 均不能越过提交所有权栅栏。
17. WorkItem 补充输入只进入下一 Attempt；单节点取消确认真实 Task 终止。
18. 历史 Run 在翻页间更新不会漏/重，maintenance/reconcile 必须处理第 501 条活动 Run。
19. 旧 Worker 丢失命令 lease 后，Delivery/Cancellation/Flow 结果不能提交；新 owner 使用同一 effect 收敛。
20. `requestCancel` 已成功而 `cancel` 失败时，重试不重复第一阶段，并且只有精确 cancelled Flow 才确认。
21. PROVISION/FLOW_SYNC 自动退避耗尽后暴露人工 `RECONCILE`；重试同一 command/effect，不复制外部对象。
22. Lifecycle stop 会 abort runtime await、释放未处理 lease、清空 timer 并等待已登记后台任务。
23. command 多次被 lease/reclaim 只增加 `attempts`，基础设施 defer 不增加 `failure_count`；只有业务失败消耗 FailureRetryPolicy 预算，人工 reconcile 只清零失败预算。
24. PROVISION 在外部调用前持久写 `effect_started_at`；终态 Run 即使恢复该 command 也只能 controller lookup + observe-only，`ABSENT` 不创建，`AMBIGUOUS` fail closed。
25. provisioning/closure specifications 拒绝错 controller、错 run、越界 revision、取消中 running Flow 和冲突终态；冲突进入 Intervention 并保留 `RECONCILE`。
26. Attempt timeout 与带 `terminalReason=TIMEOUT` 的 `CANCEL_ATTEMPT` 同事务落盘，只有真实取消确认后才成为 `TIMED_OUT`。
27. 终态 Run 迁移与 `FLOW_SYNC` 同事务；启动修复只补缺失 command，不重复已有 effect。
28. transaction callback 返回原生 Promise 或自定义 PromiseLike 时在 commit 前拒绝并回滚；nested case 只回滚 savepoint。
29. retention 保留 failed PROVISION/FLOW_SYNC 和非 IDLE reconcile Run；自动策略不能隐式弃置 Flow 对账。
30. 删除 blocker 的 command/Flow/revision/diagnostic 任一变化都会使 token 失效；只有 preview、弃置原因与单独确认、最终删除确认全部成立才写 tombstone 完整证据。
31. 单 blocker preview 或 DELETE 接受后新增第二条 failed Flow command 均 fail closed；Run、job、command、receipt 和 tombstone 保持与失败阶段一致。
32. retention cursor 穿过超过一个 page 的永久 blocker 前缀，旧 24 小时 cursor 仍从断点续扫；只在真正 exhausted 时回到头部。
33. disconnect 或 connection/runtime instance 变化提升 projection epoch，旧异步响应不能复活旧状态；事件分页不完整时 UI 明示原因并以 snapshot 为权威。
34. Agent 在批准后被删除、移出插件 allowlist、移出协调 Agent policy 或 capability hash 漂移时，pre-effect 事务原子阻断 command，adapter 也不能调用 `subagent.run()`。
35. 任一写请求的 expected instance 与 SQLite 权威实例不一致时，在 receipt/领域写入前失败；首次响应和 replay 都返回并由 Desktop 校验同一实例。
36. 计划修订同时遇到任一 revision 的 Planner/Worker/Synthesizer 活动或 UNKNOWN Attempt 时 fail closed；历史 Worker/Synthesizer 迟到结果只记 `ABANDONED`，不污染 current plan。
37. 维护 lease 过期和重复恢复只产生一次每 Run 事件/Intervention，gate 持续关闭；malformed lease 不被删除，错误 owner 不能 exit。
38. 任一 runtime promise 永不 settle 时在 operation deadline 后返回 `RUNTIME_TIMEOUT` 且无 timer/unhandled rejection 泄漏；可能已开始的效果仍以原 command/effect 进入 UNKNOWN 对账。
39. `message.__openclaw.id` 优先于 legacy id；string/block-array history 与旧 cache 均归一成可渲染字符串，同时保留 tool/thinking raw blocks。
40. 文本、按钮、决策、重发、Quick Chat、文件和语音共享同一发送终态；Gateway 拒绝时 typing 必须释放、队列项及附件不得丢失，Artifact 不执行模型生成脚本。

---

## 12. 发布准入

发布版本必须同时满足：

1. 任何 Run 都能解释当前状态、调度闸门、未解决 Intervention、最后成功命令和下一步动作。
2. 任何副作用都能关联到唯一 Attempt/DeliveryAttempt 和插件派生 effect key。
3. 满足 10,000 events / 64 MiB materialization / 16 MiB output 合同的 Run，能导出计划、批准、裁剪后的 Attempt、Evidence、决定、交付和事件时间线；超限异步任务必须明确 `FAILED`，不得伪装成功。
4. Desktop 关闭、Gateway 重启、重复命令和事件不会产生隐式重复执行。
5. `COMPLETED` 必须有 exact transcript delivery evidence；否则只能是 `DELIVERY_PENDING/CANCELLED/FAILED`。
6. reset/reuse sessionKey 不会改变既有 Run 的 origin 或 delivery target。
7. token、构造后的完整 prompt、思维链、完整 Worker transcript 和无界工具输出不进入协作 SQLite 或 JSON 导出；内部结构化 Attempt 输入/补充输入遵循第 2.4/2.5 节边界，OpenClaw Child transcript 遵循原生留存。
8. 插件安装失败、升级失败和 schema 不兼容都有不依赖插件运行态的恢复路径。
9. 每个外部写请求和 replay 都绑定同一 `collaborationInstanceId`；实例重建后旧命令不能跨实例执行。
10. Agent 授权必须在外部效果前按当前配置重新判定，计划时允许不构成执行时授权。
11. 上一版 `bea9b0ac...` bundle 曾在固定 digest 的 OpenClaw `2026.7.1` 隔离环境中通过适用的 P0-01/02/03/05/06/07/08；当前 `62fa1fca...` bundle 必须重新完成这些门禁，并继续完成 P0-04/09/10/11/12/13/14、Flow/session/Desktop、浏览器视觉和 24 小时 fault/soak；所有旧 hash evidence 只能作为历史记录。
12. 远端 `main@1956f23` / `1.2.27` 三方整合已经完成；生产发布仍必须闭环 updater 签名资产合同、可信 default-branch promotion、`main`/tag ruleset、required-reviewer environments 和签名 secret scope，candidate-only 构建不得被解释为 production release。
13. 正式 evidence 必须通过发布 producer 与 validator 的文本 scanner，并由 attestation 验证 source/ref、producer run/attempt 及 controller/目标 source 的双身份；runner 的 boolean 声明和未解决的远端最后写入窗口不能作为这些事实的替代。
14. GitHub Release 的 Node transaction adapters 必须作为可恢复事务执行：authenticated draft discovery 固化 immutable release id，远端集合由 Specification 校验；仅补偿 exact empty `starter`，上传从 stable file descriptor 经 release-id endpoint 完成，模糊写结果先 reconcile 后 retry；读、删、上传和 release create/publish 共享 Retry Policy，普通瞬态错误短指数退避，明确的 403/429 限流遵循 `Retry-After` 或 `x-ratelimit-reset`，无提示时至少等待一分钟；60 秒 provider-wait cap 或共享 RetryBudget 不足时直接 fail closed，不得提前重试。workflow 的 release create 与 release-id publish 已统一通过 `scripts/mutate-github-release.mjs`，POST/PATCH 响应不确定时先按 release-id、再按 tag+marker 做有界对账；剩余 `gh` 调用仅限 attestation 或只读 tag/ref 检查。manifest、draft/published 资产集合和 tag target 在提交前后保持同一 source identity。
15. 发布 publication 必须由 `JUNQI_RELEASE_PUBLICATION_SEAL` 绑定 source/ref、精确顶层文件集合、大小和 SHA-256；seal 由稳定文件复制后独占写入，attestation 前 publication 目录锁为只读，reconcile/upload/verify CLI 必须复核同一 seal。已知 candidate release id 只按同一 id 对账，PATCH 歧义无法确认时禁止再次变更；合法 2 GiB 文件的 45 分钟请求、120 分钟事务、150 分钟 job 预算必须保持一致。Desktop export/delete completion 同样以 Run + Job receipt 和实际内容 digest 为不可变关联键。

完整的外部证据链、供应链和仓库治理门禁见 [`openclaw-collaboration-release-evidence-audit.md`](openclaw-collaboration-release-evidence-audit.md) 及其对应规格；该专项审计中的任一开放 residual 都会阻断生产发布。

---

## 13. OpenClaw 能力依据与限制

- [Task Flow](https://docs.openclaw.ai/automation/taskflow)：Managed Flow、revision CAS、等待和取消；Flow 不是调度器，终态记录会清理。
- [Background Tasks](https://docs.openclaw.ai/automation/tasks)：Subagent Task、状态、取消、delivery state 和保留边界。
- [Plugin Runtime](https://docs.openclaw.ai/plugins/sdk-runtime)：Subagent、Task/Flow、Agent events、stateDir 和 transcript runtime。
- [Plugin SDK](https://docs.openclaw.ai/plugins/sdk-overview)：自定义 Gateway RPC、service、session lifecycle 和事件能力。
- [WebChat](https://docs.openclaw.ai/web/webchat)：`chat.history` sessionId、`chat.send` 幂等和 transcript 事实边界。
- [Subagents](https://docs.openclaw.ai/tools/subagents)：隔离 session、Task、并发、结果回传和 allowAgents 语义。
- [Plugin CLI](https://docs.openclaw.ai/cli/plugins)：安装索引、enable/allow、版本 pin、update/uninstall 和 runtime probe 边界。
- [Workboard](https://docs.openclaw.ai/plugins/workboard)：未来 capability 调研依据；V1 未实现镜像。

Portable Core 不依赖 OpenClaw 私有接口，也不依赖普通外部插件无权使用的 in-process Gateway request。若阶段 0 证明某一必需能力只存在于私有或 trusted-only surface，必须改变设计或推动 OpenClaw 提供公开 API，不能在实现中静默导入内部模块。

---

## 附录 A：审查问题关闭矩阵

| 审查问题 | 文档修订 | 发布验证 |
| --- | --- | --- |
| Desktop 退出会结束 Managed Gateway | 1.2、3.1、3.2 | `P0-09/10` |
| origin session/message identity 不可靠 | 1.3、5.1 | `P0-02/04` |
| `subagent.wait` 无精确 delivery receipt | 4.6、5.9 | `P0-03/04` |
| token localStorage 和 admin scope | 3.4 | 阶段 1 安全测试 |
| Managed Flow 与 Subagent 双 Task | 1.4、5.5 | `P0-05/06/07` |
| 状态机、partial、stop dispatch、删除 RPC 缺口 | 4、7 | 单元/属性/合约测试 |
| Attempt/partial/cancel/Delivery 并发覆盖 | 2.3、4、5、6.1 | 竞态回归 + 真实 Gateway P0 |
| WorkItem 补输入/取消/UNKNOWN 不闭环 | 4.4、4.5、5.8、7.2 | entity CAS/真实 Task 回归 |
| history cursor 可变、active scan 固定 500 | 6.1、7.4、8.3 | 分页突变和 501 Run 回归 |
| 插件安装目标和 trust tier 不明确 | 3.2、3.3 | `P0-01/11` |
| Chat 卡片、事件重放和 reset/delete 未闭环 | 7.4、8 | 前端/恢复测试 |
| 存储迁移和更新绕过活动运行 | 6.3 | 生命周期测试 |

实现范围以第 0.6 节列出的源码入口和当前代码为准；自动化结果只记录在当次 CI/发布记录。真实 Gateway 门槛和 soak test 全部通过前，文档保持“发布验收中”。
