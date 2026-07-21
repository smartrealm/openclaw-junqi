# OpenClaw Agent 协作收口计划

日期：2026-07-19

基线：Plugin `0.3.0`，SQLite schema `12`，OpenClaw `2026.7.1`。

## 1. 当前结论

OpenClaw Agent 协作的代码层领域状态和自动化回归已完成：Plugin **364/364**、Desktop **766/766**、发布/真实 Gateway 辅助脚本 **192/192** 通过，插件 package contract、Desktop production build、lint 和 425 文件模块边界检查通过。当前 bundle SHA-256 为 `62fa1fcacf338b7f4e735f2726b999f4640a5db5de3f2f0fbfe492e11dc6c6fe`，metadata 与 Tauri resource 一致并报告 plugin `0.3.0` / schema `12`、155 个白名单文件。已有 structural P0-01 与 behavioral P0-02/03/05/06/07/08 evidence 绑定上一版 `bea9b0ac...` archive，不能覆盖当前 bundle；当前包的真实 Gateway、Rust、浏览器视觉 QA 和 24 小时 fault/soak 仍需重跑。behavioral evidence 继续要求 `PAYLOAD_FREE_LOG_PROJECTION_V2`，仅保留固定事件码和脱敏标记，不持久化 prompt/plan 原文。

## 2. 实施状态

| 状态 | 阶段 | 能力 | 验收事实 |
| --- | --- | --- | --- |
| [x] | A | State Machine | Run 迁移受领域状态机约束；Attempt recovery reducer 对 Task 观察生成显式决策 |
| [x] | A | Durable Outbox | 领域写入与 command 同事务；`available_at` 持久化 FailureRetryPolicy 延迟；timeout cancellation 也以 outbox 落盘 |
| [x] | A | Lease/CAS 与失败预算 | `attempts` 只做 `id + lease_owner + attempts` 代际栅栏；`failure_count` 独立记录业务失败预算，基础设施 defer 不消耗预算 |
| [x] | A | Effect intent | PROVISION 外部调用前 lease-CAS 写 `effect_started_at`；恢复不再用 claim 次数猜测外部效果 |
| [x] | A | Command Result Committer | 先 CAS 结算当前 command，再在同一事务提交 Delivery/Cancellation/Flow 结果 |
| [x] | A | Projection watermark | Cancellation command 进入终态时同事务推进 Run revision 并追加结算事件，服务端残余风险授权变化可被 Desktop 单调观察 |
| [x] | A | Intervention Resolution Policy | retry 与 run cancellation 分类本地可替代事实和外部 blocker；只解析明确被当前操作消解的 Intervention，未知/残余风险保持开放 |
| [x] | A | Nested SAVEPOINT | 嵌套 Unit of Work 不再开启第二个顶层事务；内层失败局部回滚；原生 Promise/自定义 PromiseLike 在 commit 前被同步事务 guard 拒绝 |
| [x] | A | Task authority | persistent Task 是 Agent 执行事实来源；UNKNOWN 不重新调用 Agent |
| [x] | A | Sticky cancellation | Attempt/Run 取消、完成、timeout 竞态只保留一个终态和一致 Evidence |
| [x] | A | Delivery Specification | exact target/artifact/revision/effect 不可变；UNKNOWN 同 key 对账 |
| [x] | A | Two-phase Flow cancel | requestCancel 已提交后可从原 expected revision 恢复第二阶段；精确终态确认 |
| [x] | A | Lifecycle Supervisor | single-flight、timer、AbortSignal、error observation 与 shutdown drain 统一管理 |
| [x] | A | Agent authorization Specification | 在外部效果前同步重验 effective Agent allowlist 与持久化 capability config hash；Service 事务栅栏与 Runtime Adapter 双层 fail closed |
| [x] | A | Runtime deadline Decorator | 按 runtime operation 应用有界 deadline policy；timeout 显式化为 `RUNTIME_TIMEOUT`，清理 timer 并吸收迟到 settle，保留 UNKNOWN/effect-key 恢复语义 |
| [x] | B | PROVISION recovery | exact controller lookup 返回 `FOUND/ABSENT/AMBIGUOUS`；ProvisionExecutionPolicy + provisioning/closure specifications；终态只观察，冲突进入 Intervention + `RECONCILE` |
| [x] | B | FLOW_SYNC recovery | Run 终态与 sync command 同事务，启动原子补建缺失 command；自动有界退避，失败暴露 `RECONCILE` 并重试原 effect |
| [x] | B | Session mutation | reset/delete 前持久 fence；cancel-and-wait、stop-and-retarget、expiry recovery 闭环 |
| [x] | B | WorkItem control | 一次性输入、revision CAS、真实 Task cancellation、UNKNOWN 人工解决 |
| [x] | B | Partial/Delivery races | partial supersession、SENDING ownership、retarget/abandon fence 已覆盖 |
| [x] | B | Partial application Policy | maintenance、session mutation、closure 外 Intervention 在事务前后形成 fence；fresh accept 精确关闭旧损坏 decision，closure waive 前重算全 Run blockers |
| [x] | B | Current-plan aggregate | `CurrentPlanScopeRepository` 统一当前计划指针和 WorkItem 作用域；修订前校验全部 revision/kind 静默性，历史完成只记录 `ABANDONED` |
| [x] | B | Settlement boundary | `SettlementSpecification` 区分 required settlement、partial waiver closure 与全 Run active/UNKNOWN quiescence；synthesis/terminal 两处防线避免独立 Worker 被吞掉 |
| [x] | B | Maintenance lease Specification | 持久 lease 严格解码为 ACTIVE/EXPIRED/MALFORMED；CAS 过期恢复、幂等 Intervention、稳定 Desktop owner + lease-id 双栅栏退出均 fail closed；45 分钟租约覆盖 35 分钟绝对更新窗口，使用点要求至少 37 分钟剩余（30 分钟 package/fallback + 5 分钟 Gateway 恢复/核验 + 2 分钟 IPC/回连/精确释放）；普通完成同时核对权威状态和本地 `expiresAt`，不释放已过期 lease，必须显式 recovery |
| [x] | B | Terminal maintenance completion | Planner/Worker/Synthesizer 使用 `TerminalAttemptCompletionPolicy` 精确 phase/resume bridge；Delivery pre-effect gate 对同 effect key 持久 defer，不耗业务失败预算 |
| [x] | B | Terminal recovery projection | Delivery 确认后重新计算 recovery blockers；无关 Intervention 未解决时 Run 终态保留 `ATTENTION_REQUIRED` |
| [x] | B | Export sidecar isolation | EXPORT 失败只结算 `export_jobs`，不污染 Run/Delivery/intervention；覆盖维护 defer + 大导出失败 + 单次 transcript 收敛 |
| [x] | B | Residual execution risk | `ResidualExecutionRiskSpecification`、持久 decision/event/intervention、late-result/no-redispatch fence，以及 clone/delete/retention 与 UI 风险提示闭环 |
| [x] | C | History/maintenance | 不可变 cursor、Run 501 全量扫描、有界响应；retention 阻断 failed PROVISION/未完成 FLOW_SYNC；显式删除 Flow abandonment 写 tombstone 审计证据 |
| [x] | C | RunDeletionPolicy | 只读 Query Repository 投影 decision facts 与最多两个 blocker witnesses；纯 application policy 分别约束 preview、显式执行、retention、retry；Service 在 IMMEDIATE 删除事务内重读并 fail closed |
| [x] | C | UI projection/history adapter | exact connection/runtime binding、instance write fence、projection epoch ABA fencing 与 disconnect invalidation；history 优先读 `__openclaw.id`，文本与 rich blocks 分离归一化 |
| [x] | C | RPC/security boundary | 40 个 RPC、scope、错误映射、exact target bootstrap 与离线 rollback 自动化覆盖 |
| [x] | D | Automated regression | 2026-07-20 Plugin 364/364、Desktop 766/766、辅助脚本 192/192；package contract、Desktop TypeScript 与 production build 通过 |
| [x] | E | Current bundle parity | SHA-256 `62fa1fcacf338b7f4e735f2726b999f4640a5db5de3f2f0fbfe492e11dc6c6fe`；metadata/Tauri resource 与 archive 一致；155 文件白名单通过 |
| [ ] | F | Real Gateway (适用范围) | 当前 `62fa1fca...` bundle 尚未重跑；上一版 `bea9b0ac...` evidence 仅作历史记录 |
| [ ] | G | Product release | 真实浏览器视觉 QA 与 24 小时 fault injection/soak |

发布证据链补充状态（2026-07-18）：三条 trusted producer workflow、source-topology contract test、扁平 installer staging、source/bundle/digest asset manifest、持久化并 attested 的 release decision 已加入仓库。Producer 当前会在可信默认分支 promotion、真实 Gateway 全 P0、installer-bound browser 或 24 小时 fault harness 任一缺失时写入 blocker 并以非零退出；这是一道故意的 fail-closed 门禁，不是生产证据通过。`release.yml` 已移除 `v*` trigger，来源策略明确要求 trusted promotion；未来 gate 才能要求三次独立 producer run、同一 source SHA/ref 和完整 validator contract。

发布资产快照现在由 `scripts/release-publication-seal.mjs` 作为 Value Object/Specification 管理：seal 绑定 source/ref、精确文件集合、大小和 SHA-256，CLI 的 reconcile/upload/verify 均强制校验；publish job 在 attestation 前锁定 publication 目录只读。release mutation adapter 对已知 candidate id 只按同一 id 收敛，PATCH 歧义无法确认时不再重复变更；合法 2 GiB 上传的 request/shared/job budgets 已统一为 45/120/150 分钟。

供应链补充：workflow action 已固定完整 commit SHA，pnpm `9.15.9` 与 Rust `1.96.0` 也固定；producer 执行和 attestation 分离为最小权限 job，并在 promotion 缺失时阻断；手动 candidate 只允许代码级 `main` 输入且不读取签名密钥；tag-owned workflow 当前不可触发。仅正式 Gateway/visual/soak producer publish 根及 release validator 下载副本在上传前/下载后执行共享文本 secret scanner；quality JSON、structural smoke 和 binary 内容不经过同一文本扫描，仍是明确 residual。soak/Linux runner preflight 只读取受保护 repo boolean，不能证明实际 JIT、online 或一次性 runner；attestation JSON 尚未解析并绑定 producer run id/attempt，controller 与目标 release source/tag 的双身份也未闭环。未来 Windows 制品在上传前必须完成 Authenticode 签名和验证。当前单候选视觉证据遇到多平台 release asset 会主动阻断，待主线 updater manifest、per-platform installer-bound harness、真实证书/notarization、仓库保护、唯一 promotion writer 和 protected environments 完成后才可开放。

### 2.1 结构性维护项

- [x] 插件/Desktop 错误码改为常量派生联合类型；跨包契约测试保证插件公开码全部被 Desktop 识别，`RUNTIME_TIMEOUT` 不再降级为 `RPC_FAILED`。
- [x] Command Dispatcher 已按 `CommandHandlerRegistry` 注册每种 `CommandKind`，运行时拒绝重复、未知 handler 和非布尔 settle 决策；Retention、Session Mutation、Export/Delete 和 Projection 仍复用现有 Repository、Specification、Policy 与 Unit of Work，事务边界未改变。更大范围的 Process Manager/Saga 拆分保留为后续独立重构。
- [x] Bootstrap operation id 统一限制为单一安全路径组件；journal、restart/abandon/recovery、operation leaf、backup root、Docker `.junqi-bootstrap`/staging root 与 operation directory 的预存在 symlink/non-directory 均 fail closed；cleanup preflight 不会为缺失 artifact directory 自动创建目录，以上边界均有回归覆盖。
- [x] Unix bootstrap abandoned-archive 已升级为逐级 pinned descriptor、`O_NOFOLLOW` regular-file 读写、descriptor-relative cleanup、目录 `fsync` 和 no-replace rename；覆盖 symlink component、archive-root symlink 与 parent swap 回归。Windows/non-Unix fallback 仍是路径级边界，后续需补充 reparse-point/no-follow 实现后才能宣称跨平台等价。
- [x] Rust updater 现在用一个 monotonic absolute deadline 覆盖 detect-before、registry probe、Gateway stop、package update、service/managed restart、restore 和 post-update re-detect；同步包校验在受同一 deadline 约束的 blocking worker 内执行，mutation 探测不写 selection 文件；package/fallback 共用 30 分钟预算，并保留 5 分钟恢复/核验余量。mutation 前校验 owner/owned-child 不变量；RAII restart flag/generation 覆盖 ManagedChild/SystemService 全窗口，ManagedChild 仅在旧进程回收且端口释放后恢复；更新命令输出、Unix 进程组/Windows 进程树终止和回收均有界。普通 start/restart/stop/ensure 同样 fail closed 校验 owner/child，ManagedChild 使用独立进程组并要求子树回收与端口释放，repair 与 update 共用 lifecycle gate。System Service 的 updater 与普通 restart 都必须由 `gateway status --json --require-rpc` 同时证明 daemon config、service env、supervised/listener PID、端口和 RPC/CLI/Gateway 版本；External/Docker/None 不会被 TCP liveness 改写成 Managed Child。lease renewal 仍未实现；极端超时保持 `EXPIRED` gate 并要求显式 recovery，长时可用性仍需 fault/soak 证据。
- [x] Storage migration 现在先解析冷启动的 Gateway owner，再按 ManagedChild/Docker/SystemService 分支停止并确认端口释放；External/未归属 listener fail closed。复制使用 RAII staging、物理 overlap/symlink 边界和原子 config patch；bootstrap 或恢复任一阶段失败都会按候选停止、旧 bootstrap 恢复、原 owner 恢复和严格 attestation 顺序补偿。service CLI 复用 bounded OpenClaw command runner，输出受限且 Unix/Windows 子树终止有界。
- [x] Maintenance owner 已从 renderer-only localStorage 迁移为 Tauri durable owner 文件；Unix 使用 pinned parent descriptor、`O_NOFOLLOW`、原子 `linkat` create-if-absent 和并发首次创建收敛，损坏/父目录 symlink 不会轮换身份。
- [x] 六个操作型只读 RPC 已由 `CollaborationReadRpcContract` 统一声明参数/返回值，`wire-codec.ts` 的穷尽 Decoder Strategy Registry 负责 integer/timestamp/enum/nullable/alias conflict/identity fail-closed；生产默认路径使用 `CollaborationClient` 命名 Typed Read Facade，测试或适配器显式注入 raw RPC 时仍强制经过同一 decoder，不再由 coordinator/action 层猜测 response shape。无 decoder 的 public raw `read()` 已移除；仅保留 private、decoder 必填的 transport helper，生产代码也不再直接旁路 `gateway.call('junqi.collab.*')`。prepare 的 slim active-run projection 使用独立 `CollaborationRunReference`，不再通过 sentinel 字段伪造完整 summary。
- [ ] 将 Rust bootstrap 的 package verification、journal/recovery、config mutation 和 Gateway restart 拆为独立 application services；拆分前必须保留 exact target fingerprint、offline rollback 和 journal fencing 回归。

## 3. 已验证的关键反例

- [x] OpenClaw Agent 启动后响应丢失：重启只绑定原 persistent Task，`runAgent` 不增加。
- [x] Task 缺失、歧义、身份不匹配或 lost：保持 UNKNOWN 和关闭 dispatch。
- [x] 旧 Worker 丢 command lease：Delivery/Cancellation/Flow 结果 CAS 失败；新 owner 使用原 effect 收敛。
- [x] CREATED queued Worker stop：旧 Attempt CANCELLED、WorkItem READY；resume 只创建一个新 Attempt。
- [x] DISPATCHING + PENDING command 遇 session mutation fence：Attempt UNKNOWN、resume 被阻止、不二次分派。
- [x] Run CANCELLING 且 cancel outbox 缺失：重启补建 CANCEL_ATTEMPT 并关闭运行。
- [x] Flow `requestCancel` 成功但 `cancel` 抛错：重试不重复 request，只接受精确 cancelled 结果。
- [x] PROVISION/FLOW_SYNC 达到自动重试上限：快照暴露人工 `RECONCILE`，同 command/effect 重试成功。
- [x] command lease 重领只增加 `attempts`；业务失败才增加 `failure_count`；maintenance/session fence defer 不会提前耗尽重试预算。
- [x] PROVISION 写 `effect_started_at` 后重启：按 controller lookup 恢复；重复 controller 返回 `AMBIGUOUS` 并 fail closed。
- [x] 终态 Run 恢复 PROVISION：只观察已有 Flow；`ABSENT` 不创建，closure 冲突保留 Flow identity 并进入 Intervention + `RECONCILE`。
- [x] Attempt timeout：状态迁移与带 TIMEOUT 意图的 cancellation outbox 同事务；未确认远端取消不伪装 `TIMED_OUT`。
- [x] Run 终态与 `FLOW_SYNC` command 同事务；启动修复缺失 command，已有 command 不重复。
- [x] transaction callback 返回 PromiseLike：顶层事务整体回滚，nested transaction 只回滚 SAVEPOINT。
- [x] Retention 遇 failed PROVISION、未完成 FLOW_SYNC 或非 IDLE reconcile：保留 Run，不自动放弃 Flow 对账。
- [x] 显式删除失败 Flow 对账：token 绑定 blocker 证据；UI preview、弃置原因/独立确认、最终删除确认三道门槛；tombstone 永久保存弃置字段。
- [x] 单 blocker preview 后新增第二条 failed Flow command：提交入口和已入队 DELETE 的执行事务均拒绝，Run/job/tombstone 不发生越权提交。
- [x] 删除 retry 只继承一个完全相同的 blocker；变化或至少两条 blocker 要求新 preview，精确单 blocker 可恢复并把原证据写入 tombstone。
- [x] Retention 宽候选游标不按 24 小时回头；直到有序扫描耗尽才清空，page/time-budget 截断安排近时续跑，永久 blocked 前缀不会饿死后续候选。
- [x] 删除事实使用严格持久化解码；损坏的状态、时间或 Flow revision 返回 `INVALID_RESPONSE`，不能被默认值解释成可删除。
- [x] Disconnect/instance swap 提升 projection epoch，旧请求不能回写；事件页不完整时保存 reason 并在 UI 明示。
- [x] Transcript append 已提交但响应丢失：重启使用原 Delivery Specification/effect，只保留一条消息。
- [x] Session mutation fence 与 queued/leased dispatch、计划创建、resume 的竞态均 fail closed。
- [x] Lifecycle close 会 abort hung runtime call、释放未处理 lease、清 timer 并 drain。
- [x] Agent 在计划批准后、外部效果前被撤权或 capability hash 变化：command/Attempt 失败且 WorkItem/Run 进入人工介入，`subagent.run` 不被调用。
- [x] 旧 Desktop 连接将写请求发往已替换的插件实例：`expectedCollaborationInstanceId` 在任何领域写入前拒绝，响应实例不匹配也由 Desktop codec 拒绝。
- [x] 新计划已成为 current 后到达的历史 Worker/Synthesizer 完成：Attempt 转 `ABANDONED` 并写审计，不能结算当前计划。
- [x] Partial 接受只关闭声明的 waiver closure；独立 Worker 仍 active 时不启动 synthesis，任何 active/UNKNOWN Attempt 都阻止 Run terminal transition；独立 Worker 结算后才继续。
- [x] Partial durable payload 腐坏先 quarantine；只有 fresh accept 可精确关闭旧 `PARTIAL_DECISION_CORRUPT`，maintenance、session mutation 或 closure 外 Intervention 均使应用 defer，不能绕过恢复事实进入 synthesis。
- [x] maintenance lease 过期、重复恢复、owner 不匹配或内容损坏：门禁保持关闭，过期通知幂等，MALFORMED 不被默认为 INACTIVE；foreign Desktop 不能释放租约，短租约不能启动 30 分钟维护操作。
- [x] maintenance 过期期间 Planner/Worker/Synthesizer terminal result 按 kind/resume phase 精确桥接；Delivery append 在 pre-effect 再次检查 maintenance 并复用原 effect key defer。
- [x] Export sidecar 在 DELIVERY_PENDING 期间失败只更新 export job，不写 `COMMAND_FAILED` 或改变 Run；维护释放后原 Delivery 仍只提交一条 transcript。
- [x] 接受远端 Task 残余风险后，本地 Run 保持 `CANCELLED + ATTENTION_REQUIRED`，审计 Intervention 不被 restart 清掉；迟到结果不写 Evidence、不 redispatch，clone/delete/retention fail closed。
- [x] Cancellation command 从 actionable 进入 terminal 后，即使没有其他 Run 字段变化，也会增加 Run revision 并追加事件；Desktop 不会因相同 projection watermark 永久隐藏新授权动作。
- [x] Delivery 完成时若存在无关未解决 recovery Intervention，Run 可进入业务终态但保持 `ATTENTION_REQUIRED`，不会被无条件重置为 `IDLE`。
- [x] OpenClaw runtime Promise 永不 settle：操作级 deadline 结束等待，迟到 resolve/reject 不产生 unhandled rejection 或重复效果。
- [x] `chat.history` 返回 `__openclaw.id` 与 block-array content：原生 ID 稳定归一化，UI 仅对文本字符串执行 trim，rich blocks 保留供 tool/thinking 渲染。

## 4. 最终 bundle 阶段

- [x] `npm run validate:plugin` 在最终源码上通过。
- [x] 当前源码 archive SHA-256、生成 metadata 与 Tauri resource 一致：`62fa1fcacf338b7f4e735f2726b999f4640a5db5de3f2f0fbfe492e11dc6c6fe`。
- [x] `src/generated` 与 `src-tauri/resources` metadata 字节一致，均报告 version `0.3.0`、schema `12` 和相同 archive。
- [x] tgz 只有声明的 `dist`、manifest 和 README 内容，无源码、测试、`node_modules` 或嵌套归档；155 个文件通过 pack validator，独立 consumer 的 strict types 与 runtime exports 通过。
- [x] Desktop embedded bundle hash、bootstrap health contract 与 package manifest 一致。

OpenClaw `2026.7.1` 的上游 Zod 声明在 TypeScript `5.9.3` 且 `skipLibCheck=false` 时存在 TS2636；最终 JunQi packed consumer 仍应使用与插件一致的 `skipLibCheck=true` 配置验收，并把结果写入本节。该上游限制不得误记为 JunQi 声明通过完全库检查。

## 5. 真实 Gateway 阶段

必须使用一次性容器、独立 OS 账户或完整隔离的 `HOME`、XDG 和 `TMPDIR`；禁止 `--dev` 和默认用户 profile。

- [ ] `P0-01` 当前 `62fa1fca...` tgz 作为普通外部插件安装、启用并通过 structural health；上一版 `bea9b0ac...` evidence 不得复用。
- [x] `P0-02` 重复真实 `chat.history` 读取可以稳定绑定 session、OpenClaw 原生 message identity 和 chat idempotency key。
- [x] `P0-03` exact transcript append 在 acknowledgement loss 恢复后仍只保留一条消息。
- [ ] `P0-04` session reset 竞态与 transcript rebound/mismatch 尚未在真实 core RPC 上验收。
- [x] `P0-05` 一个 `subagent.run()` 对应一个 persistent Task，不经由 `managedFlows.runTask()`。
- [x] `P0-06` Gateway 重启后按 owner session 与确定性 child session identity 找回唯一 Task/run，零匹配或多匹配 fail closed。
- [x] `P0-07` 取消 Run 后持有的真实 Worker Task 被确认终止，Attempt 收敛。
- [x] `P0-08` Gateway 重启从原 Task 恢复，不产生第二次 Agent 分派。
- [ ] `P0-09` JunQi Desktop 退出期间的外部 durable Gateway 连续性与 UI 恢复尚未验收。
- [ ] `P0-10` Managed Child 识别和 durable collaboration 启动禁止尚未验收。
- [ ] `P0-11` portable 插件完整核心流程与 trusted-only Gateway request 负向探测尚未共同验收。
- [ ] `P0-12` Workboard `supported: false` 且核心结果不依赖 Workboard 尚未完成行为验收。
- [ ] `P0-13` reset/delete session identity capability 分离探测与 UI 强制取消策略尚未验收。
- [ ] 两阶段 Managed Flow cancel 在真实重启/异常窗口收敛。
- [ ] session reset/delete 的完整产品流程在真实 core RPC 上 fail closed。
- [ ] JunQi Desktop 退出、重连、实例替换后的 durable 推进与 UI 恢复闭环。

Capability response 的 `behaviorVerified=false` 必须保持；单次 load、HTTP 200 或 capabilities 调用不能替代以上行为。

## 6. 发布阶段

- [x] 当前候选完成 Rust fmt/check/test/clippy 全量重跑；Plugin 364/364、Desktop 1157/1157、辅助脚本 207/207、Rust 534/534、package contract、Desktop production build、lint、严格 Clippy（`-D warnings`）与 `git diff --check` 均通过。
- [ ] Chat 协作工作台桌面和移动 viewport 完成真实浏览器截图与交互 QA。
- [ ] 完成至少 24 小时 restart、network fault、disk fault、Task/Flow retention 和安全 soak。
- [x] 以远端 `main@1956f23` / `1.2.27` 完成三方整合，合并提交为 `5aa8901`。
- [ ] 闭环 updater 签名资产合同、trusted default-branch promotion、`main`/tag ruleset、required-reviewer environments 和签名 secret scope。
- [ ] 证明 soak/Linux producer 实际使用受控 JIT/online/一次性 runner；受保护 repo boolean 只能作为前置声明，不能作为运行事实。
- [ ] 解析 attestation predicate，绑定选定 producer 的 run id/attempt，并完成 controller 身份与目标 release tag/source 的双绑定。
- [ ] 配置唯一 promotion writer 和 immutable tag/release governance，关闭最后一次远端 tag/release 检查后的并发写窗口。
- [ ] 发布记录写入最终 bundle hash、完整命令输出、真实 Gateway 环境描述和未通过项。

只有第 4-6 节以及 [`openclaw-collaboration-release-evidence-audit.md`](openclaw-collaboration-release-evidence-audit.md) 中的供应链与仓库治理门禁全部完成，才能把状态从“源码自动化闭环”改为“生产发布验收通过”。
