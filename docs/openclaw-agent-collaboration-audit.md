# OpenClaw Agent 协作最终审计

日期：2026-07-20

审计基线：JunQi Collaboration Plugin `0.3.0`，SQLite schema `12`，OpenClaw `2026.7.1`。

状态：代码层领域状态、插件自动化和当前 schema 12 bundle parity 已通过；这不等同于生产验收。现有隔离真实 Gateway evidence 仍绑定上一版 schema 11 archive，不能证明当前 archive。P0-01/02/03/04/05/06/07/08/09/10/11/12/13/14 的当前包复验、浏览器视觉 QA 与 24 小时故障注入/soak 仍是开放发布门槛。本文不把 capability 声明、局部真实行为、mock runtime 或单元测试解释成其余链路的真实 Gateway 证据。

## 1. 范围与执行边界

本次审计覆盖 Chat 原生消息身份、规划、批准、Managed Flow provisioning、OpenClaw Agent 分派、persistent Task 恢复、WorkItem 控制、Evidence、汇总、精确 transcript Delivery、历史、导出、删除、留存、session mutation、maintenance 与 Desktop bootstrap。

唯一执行链路为：

```text
JunQi Chat
  -> junqi.collab.* Gateway RPC
  -> JunQi Collaboration Plugin
  -> public openclaw/plugin-sdk
  -> Native runtime.subagent.run 或 ACP tools.invoke -> sessions_spawn(runtime="acp")
  -> runtime.tasks.runs / agent.wait
  -> exact session transcript APIs
```

Worker 只来自当前 Gateway 已配置且同时通过插件和协调 Agent 授权的 OpenClaw Agent。Managed Flow 是 Run 级镜像与取消栅栏，不是 Worker 调度器；Worker 执行不会调用 `managedFlows.runTask()`。

## 2. 验证快照

- `packages/junqi-collab` canonical `npm test`：**364/364 通过**，2026-07-20。
- 插件 TypeScript build：通过。
- Desktop TypeScript/React：**766/766 通过**；发布/真实 Gateway 辅助脚本：**192/192 通过**；两者由当前候选的 `pnpm test` 运行验证，Desktop 汇总保存在 `/tmp/junqi-desktop-tests-final.log`；`pnpm lint` 通过，模块边界 425 文件 clean。
- Desktop production `npm run build`：通过；最终构建再次生成相同 schema 12 bundle hash `62fa1fca...`。Vite 报告既有 manual chunk 循环警告，但未导致构建失败。
- Rust 的上一轮记录为 `cargo fmt/check/clippy` 通过、`cargo test --lib` **282 passed / 2 ignored**；当前 schema 12 archive 尚未重跑 Rust 门禁，因此该记录不能作为当前候选通过声明。
- 自动化覆盖 schema 2-12 migration、Attempt runtime 冻结/回填、ACP 明确拒绝与配置变更恢复、插件状态/竞态/恢复/RPC/持久化用例、501 条活动 Run 扫描、persistent Task 恢复、两阶段 Flow cancel、controller lookup/终态 observe-only、Delivery/Cancellation 旧 lease owner、执行前授权撤销、跨实例写阻断、current-plan 聚合、维护 lease 过期、runtime deadline、session mutation、Flow abandonment 删除审计、多 blocker 执行时重校验、删除 retry、authoritative deletion-job recovery、retention 游标续跑、损坏持久化事实 fail-closed、Lifecycle shutdown、普通 stop 的 Worker phase fence、partial decision plan fence/strict durable codec、partial application pre/post fence、Intervention Resolution Policy、Cancellation projection watermark、Delivery terminal blocker preservation 和服务端 residual-risk projection。
- Desktop 操作型只读边界由 typed RPC contract map 与共享 decoder registry 覆盖；命名 client facade 和显式注入的 raw test transport 均验证 alias 冲突、状态枚举、时间戳、Run/Job/Session identity、closure 去重/交叠、mutation fence 矛盾及 export artifact JSON/大小上限，不存在测试替身绕开 wire 校验的第二条路径。
- 只读 facade 进一步把 deletion/export receipt 绑定到调用 Run 与精确 Job；completed export 的 job digest、artifact digest 和实际 UTF-8 内容 SHA-256 必须一致，跨 run 或篡改内容在下载前 fail closed。partial closure 只要求 waive/blocked 互斥，并要求 active 属于二者并集，兼容领域层允许的 active overlap。
- 当前源码 bundle 为 plugin `0.3.0` / schema `12` / 155 个白名单文件，生成 metadata、Tauri resource metadata 与 archive 实算一致；当前 archive SHA-256 为 `62fa1fcacf338b7f4e735f2726b999f4640a5db5de3f2f0fbfe492e11dc6c6fe`。
- 当前源码 tgz 在独立临时 consumer 中以 TypeScript `5.9.3`、`strict=true`、`skipLibCheck=true` 通过声明检查；四个公开 runtime exports 可加载，工厂返回 `id=junqi-collab`。
- OpenClaw `2026.7.1` 自身的 Zod 声明在 TypeScript `5.9.3` 且 `skipLibCheck=false` 时出现 TS2636；这是仍需跟踪的上游类型兼容限制，不计作 JunQi 完全库检查通过。
- 2026-07-17 的早期本地 `gateway run --dev` 探针访问了默认用户 profile；该尝试仍被拒绝为隔离证据。上一版 archive `bea9b0ac8640694495fc8980c4d418fca5bc3b67f4edfc8509c28b8dd035e016` 在固定 digest 的 OpenClaw `2026.7.1` 容器、独立 volume、完整 HOME/XDG/TMP 隔离下完成 [structural P0-01 evidence](../.artifacts/collaboration-real-gateway-owner-ttl-20260719/20260718213349-264598dc20/evidence.json) 和 [payload-free behavioral P0-02/03/05/06/07/08 evidence](../.artifacts/collaboration-behavioral-gateway-owner-ttl-20260719/20260718213129-521c5279a4/evidence.json)。这些是历史记录，不覆盖当前 `62fa1fca...` archive；当前包必须重跑对应门禁。Desktop、浏览器视觉与 24 小时 soak 仍开放。
- Unix bootstrap abandoned-archive 边界已通过 pinned descriptor、`O_NOFOLLOW`、目录 fsync、no-replace rename 及 symlink/parent-swap 回归；Windows/non-Unix fallback 仍待 reparse-point/no-follow 等价实现。Maintenance owner 已持久化到 Tauri 配置目录，Unix 首次创建使用 descriptor-relative atomic `linkat`，损坏或父目录 symlink 会拒绝而不会轮换身份。
- Maintenance 普通退出同时以权威状态和本地 `expiresAt` 时钟 fail closed，延迟的 ACTIVE 投影不能释放已过期 lease；Rust bounded detector 将同步包校验隔离到受同一绝对 deadline 约束的 worker，mutation 探测不再执行无界 selection 持久化。Updater 在 mutation 前校验 owner/owned-child 不变量，并以 RAII restart flag + generation 覆盖 ManagedChild/SystemService 整个更新窗口；External/Docker/None 不会被 TCP 健康误判成 Managed Child。普通 start/restart/stop/ensure 也复用 owner/child 不变量，非托管 owner 不被静默降级或误杀；ManagedChild 子树必须确认直接 child 回收和端口释放，应用退出也向独立进程组/Windows 进程树发终止信号。更新 CLI 的 stdout/stderr、Unix 进程组/Windows 进程树终止及回收均有硬上限。System Service 的 updater 与普通 restart 均使用 `gateway status --json --require-rpc`，同时核验 supervised PID、listener PID、RPC/CLI/Gateway 版本、daemon config、service environment、port 和 config audit，单独 TCP 可达不再视为归属证明。外部 P0-14 policy v7 / proof schema 3 还要求五个 target 级独立 fixture、物理 `P014_TRACE` artifact、canonical claims digest、workflow run/attempt/case 绑定并拒绝 BOM；这只是 validator 收紧，不代表 P0-14 真实 Desktop 原子行为证据已产生。
- Storage migration 现在复用同一 owner fence：冷启动时对可达端点重新证明 SystemService/Docker，External 与未归属 listener 直接拒绝；ManagedChild/Docker/SystemService 分别停止并确认端口释放。复制采用 staging directory RAII、物理路径重叠/symlink 边界和严格 config patch；bootstrap 切换或恢复失败会按“停止候选运行时 -> 恢复旧 bootstrap -> 恢复原 owner -> 再次 attestation”补偿，不吞掉停止/回滚错误。OpenClaw service command 使用有界 CLI、进程树终止和敏感诊断截断。

## 3. 已解决的 P0 风险

### 发布证据链专项审计

外部 release evidence 的独立 findings、计划和验收规格见 [`docs/openclaw-collaboration-release-evidence-audit.md`](openclaw-collaboration-release-evidence-audit.md)、[`.planning/openclaw-collaboration-release-evidence.md`](../.planning/openclaw-collaboration-release-evidence.md) 和 [`specs/2026-07-18-openclaw-collaboration-release-evidence-bugfix.md`](../specs/2026-07-18-openclaw-collaboration-release-evidence-bugfix.md)。当前已完成 topology regression、flat installer staging、asset manifest、durable decision persistence 和 publish-aware summary；三类真实 producer 仍会在 harness 缺失时 fail closed，故外部 release gate 仍未通过。

### BUG-01 - 删除后的物理清理不可恢复

**状态：已在源码自动化解决。**

Tombstone 持久化 `PENDING/PARTIAL/COMPLETED`、有界诊断和更新时间。Run 领域行删除后，重启仍可依据 tombstone 继续清理插件管理的 export/staging 文件，不会让已删除 Run 重新可见。

### BUG-02 - 导出完成早于文件耐久性

**状态：已在源码自动化解决。**

文件和父目录 fsync 后才完成 job；`export.get` 重新校验存在性、大小和 digest，损坏的 completed artifact 会被持久标记为 `FAILED`。

### BUG-03 - Dispatch 响应丢失导致重复 Agent 执行

**状态：已在源码自动化解决；真实 Gateway restart gate 开放。**

远端可能已经启动但响应丢失时，同一 Attempt 和 command 进入 `UNKNOWN`。恢复以 OpenClaw persistent Task 为执行权威：Native 核验 `runtime=subagent + owner session + child session + run id + optional task id`；ACP 核验 `runtime=acp + owner session + deterministic label + child session + run id + optional task id`。缺失、歧义或不匹配均保持 UNKNOWN，绝不重新调用 Native 或 ACP dispatcher。

### BUG-04 - 取消、完成与 timeout 争抢终态

**状态：已在源码自动化解决。**

Attempt Recovery State Machine 以纯函数 reducer 把 Task 观察转换为等待、结算、请求取消或 Intervention。await 后重新读取 Run/Attempt，终态以 status/revision CAS 提交；sticky cancellation 优先，Evidence 只和获胜的成功事务一起提交。

### BUG-05 - Durable Outbox 所有权不足

**状态：已在源码自动化解决。**

命令所有权绑定 `id + lease_owner + attempts`，其中 `attempts` 只表示 lease fencing generation，不是失败次数。外部调用前续租并重新检查 gate；旧 Worker 丢 lease 后不能提交成功、失败或 UNKNOWN。Delivery、Cancellation、Flow 使用 Command Result Committer：同一事务先 CAS 结算命令，再写领域结果，命令 CAS 失败时领域写入不发生。

回归证明旧 Delivery/Cancellation Worker 的迟到结果被拒绝，新 lease owner 以同一 effect 收敛到终态。

### BUG-06 - SQLite 嵌套事务破坏原子命令

**状态：已在源码自动化解决。**

Database Unit of Work 在外层事务中使用 SAVEPOINT。内层失败只回滚到 savepoint，避免 `cannot start a transaction within a transaction`，同时保留外层决定整体提交或回滚的能力。

### BUG-07 - Delivery UNKNOWN 改变幂等键

**状态：已在源码自动化解决；真实 transcript restart gate 开放。**

Delivery Specification 固化 exact target、artifact id/digest、target revision、requirement、attempt no 和 effect key。UNKNOWN 只能重用原 DeliveryAttempt/effect；只有已知未发送的 `RETRY_REQUIRED` 才创建新 attempt/effect。提交还必须同时拥有当前 command lease、`SENDING` Delivery revision 和 `SUBMITTING` attempt。

### BUG-08 - Managed Flow 取消存在两阶段崩溃窗口

**状态：已在 adapter 自动化解决；真实 Gateway gate 开放。**

取消先用 expected revision 调用 `requestCancel()`，持久化 `cancelRequestedAt` 并推进 Flow revision；再调用 `cancel()`。若第二阶段失败，重试携带原 expected revision并识别 `cancelRequestedAt + revision=expected+1`，直接继续 cancel，不重复 request。只有 `found && cancelled && flow.status=cancelled` 才确认成功。

### BUG-09 - Flow/Provision 瞬时故障没有独立失败预算与人工闭环

**状态：已在源码自动化解决。**

schema 12 的 command 同时保存 `attempts`、`failure_count`、`effect_started_at` 和 `available_at`；Attempt 另存批准时冻结的 `execution_runtime`。`FailureRetryPolicy` 只按业务 `failure_count` 消耗 PROVISION/FLOW_SYNC 预算，lease reclaim 与 maintenance/session fence defer 不消耗预算；`available_at` 持久化下一领取时间。达到上限后 command 为 `FAILED` 并暴露 `RECONCILE`。人工 reconcile 重开原 command/effect 并只清零失败预算，保留 lease 代际和外部效果意图。

### BUG-09A - PROVISION 重领可能重复创建或错误复用 Flow

**状态：已在源码自动化解决；真实 Gateway gate 开放。**

PROVISION 先按 exact owner session/controller 查询，adapter 只返回 `FOUND/ABSENT/AMBIGUOUS`。`AMBIGUOUS` fail closed；`ABSENT` 只有 `ProvisionExecutionPolicy=CREATE_OR_RECOVER` 时才允许先 CAS 写 `effect_started_at` 再创建，且创建结果必须能从 owner registry 按 controller 查回。`PROVISIONING` 遇基础设施 fence 持久 defer；`CANCELLING` 和全部终态只允许 `OBSERVE_ONLY`，绝不补建 Flow。

共享 identity specification 校验 controller/run/Flow/revision/status；provisioning specification 只接受未请求取消的 running Flow；closure specification 以 provision revision 到当前 Run revision 的范围验收终态收敛。关闭状态冲突会保存已核验 Flow identity、把命令置为 `FAILED`、将 Run 设为 `ATTENTION_REQUIRED`、创建 Intervention 并暴露 `RECONCILE`，而不是覆盖远端状态。

### BUG-09B - Timeout 取消意图只存在于内存

**状态：已在源码自动化解决。**

Attempt timeout 在同一 SQLite 事务把 Attempt/WorkItem 切到 `CANCELLING`、停止分派并确保带 `terminalReason=TIMEOUT` 的 `CANCEL_ATTEMPT` outbox。重启通过该 payload 恢复 timeout 意图；只有真实 Task cancellation 确认后才提交 `TIMED_OUT`，缺少 identity、抛错或未确认均进入 `UNKNOWN + Intervention`。

### BUG-09C - Run 终态与 Flow 镜像 command 存在裂缝

**状态：已在源码自动化解决。**

Run 进入 `COMPLETED/CANCELLED/FAILED` 与对应 `FLOW_SYNC` command 在同一事务提交；启动恢复还分页扫描并在事务内补建缺失的终态 sync。FLOW_SYNC 对 `COMPLETED/CANCELLED/FAILED` 分别写 `finished/cancelled/failed`，失败由同一 command/effect 收敛。

### BUG-09D - 同步 SQLite 事务可被 PromiseLike 越界

**状态：已在源码自动化解决。**

transaction/readTransaction 的类型签名拒绝异步 callback，运行时也在 commit 前检测原生 Promise 和自定义 `PromiseLike` 并抛错回滚；nested transaction 只回滚自己的 SAVEPOINT。异步代码不能再逃出 better-sqlite3 的同步事务作用域后继续写入。

### BUG-10 - 后台任务生命周期不可控

**状态：已在源码自动化解决。**

BackgroundLifecycleSupervisor 统一拥有 single-flight、定时器、延迟任务、错误观测、AbortSignal 和 shutdown drain。stop 取消 timer、使 runtime await fail closed、释放未处理 lease，并等待登记任务结束；迟到结果仍受命令/实体 CAS 限制。

### BUG-11 - Session reset/delete 可绕过活动运行

**状态：已在源码自动化解决；真实 session identity gate 开放。**

`session_mutations` 在 core RPC 前持久建立 PREPARED fence。策略为 cancel-and-wait 或 stop-and-retarget；活动 fence 阻止新计划、resume 和 queued dispatch。Desktop 必须 complete 成功/失败；过期 fence 保持 EXPIRED 和 ATTENTION_REQUIRED，只有显式 recovery 才释放。无插件回退还必须验证 core 响应是非空成功对象、返回 key 与请求 key 一致，且 delete 明确返回 `deleted=true`，否则不清理本地附件或会话状态。

### BUG-12 - Partial 与 cancellation 顺序错误

**状态：已在源码自动化解决。**

Partial preview/accept 要求精确 Run revision、confirmation token、Intervention 状态且无 sticky cancel。Run cancel 把 pending partial 原子标记为 `PARTIAL_SUPERSEDED`；任何未确认 Task cancellation 都阻止 waive 和 synthesis。

### BUG-13 - Bootstrap 目标与回滚边界不精确

**状态：源码自动化已解决；真实 System Service/Docker recovery gate 开放。**

所有 mutation 绑定精确 target fingerprint 和 connection id。替换前必须创建私有离线 tgz、记录 archive/content-tree hash 和配置 ownership；rollback 无 registry fallback。Health 要求版本 `0.3.0`、schema 12、durable runtime 信号和必需 capabilities 全部匹配；当前 native 边界严格校验 renderer 回传字段与 connection/runtime identity，但尚未自行向 Gateway 发 authoritative capabilities RPC，真实权威复核仍是开放 P1。

### BUG-14 - 删除可抹掉失败的 Flow 对账证据

**状态：已在源码自动化解决；浏览器视觉 QA 开放。**

Retention 对 `reconcile_state != IDLE`、`FAILED PROVISION` 和任何未完成 `FLOW_SYNC` fail closed，不能自行放弃对账。显式删除 preview 返回并把 command id/status、Flow id/revision、diagnostic 连同 Run revision/digest 绑定进短期 token；证据变化必须重新 preview。UI 要求服务端 preview、非空原因与独立 Flow 弃置确认、最终永久删除确认三道门槛。服务端再次复核并只在 `abandonFlowReconciliation=true` 时允许删除，否则返回 `FLOW_RECONCILIATION_REQUIRED`。

`RunDeletionRepository` 只投影严格 decision facts 和最多两个稳定 blocker witnesses，用于表达 0、1、至少 2；它不持有授权谓词。纯 application policy 分别评估 preview、显式执行、retention 和 retry。至少两条失败 Flow command 时所有路径 fail closed；DELETE 已接受后、worker 执行前新增第二 blocker 也会在 IMMEDIATE 事务内重读并拒绝。Preview 满足条件只允许生成预览，不是执行授权。

Desktop ErrorCode/allowlist 保留该结构化错误；Provider 的纯 preview recovery policy 在 DELETE 遇 `FLOW_RECONCILIATION_REQUIRED`、以及 DELETE/PARTIAL 遇 `REVISION_CONFLICT` 时先失效旧 token，再刷新权威 Run，且不自动重放破坏性命令。

成功显式弃置会把 command、Flow、revision、diagnostic、abandoned timestamp 和 reason 写入 tombstone；client 对字段完整性 fail closed，历史抽屉显示该永久审计证据，不恢复已删除业务内容。

### BUG-15 - 旧连接异步响应可污染新 Runtime 投影

**状态：已在前端自动化解决；浏览器视觉 QA 开放。**

协作 UI 只有在 connected、verified RuntimeIdentity、当前 connection id 与投影 connection id 一致、runtime id 与 collaboration instance id 一致时可见。Disconnect/instance swap/reset 会提升 `projectionEpoch`、停止 polling、失效 bootstrap/session/tombstone generation 并清缓存；旧请求晚到不能复活旧 projection。事件游标 invalid、事件缺口或 page limit 会保留 `complete=false/incompleteReason`、刷新 snapshot，并在详情页明确标记审计时间线不完整。

### BUG-16 - 计划时授权可在真正执行前撤销

**状态：已在源码自动化解决；真实权限变更竞态与 soak 仍未完成。**

`AgentAuthorizationSpecification` 将 configured Agent、插件 allowlist、协调 Agent `allowAgents` 与批准时 capability hash 合并为 effective authorization。service 在 command 从 `CREATED` 进入 `DISPATCHING`、外部效果尚未开始的权威事务中重新判定；撤销或 hash 漂移时，原子把 command/Attempt 标记 `FAILED`、WorkItem 置为 `NEEDS_INTERVENTION`、Run 停止分派并进入 `AWAITING_INTERVENTION/ATTENTION_REQUIRED`，写事件与 Intervention，且不自动 retry。`OpenClawRuntimeAdapter.runAgent()` 在 Native `subagent.run()` 或 ACP `sessions_spawn` 前执行第二道防御性检查，Gateway 继续执行 ACP policy/backend 检查，任何未来调用路径不能绕过 pre-effect fence。

### BUG-17 - 旧实例写请求可污染重建后的 Collaboration 数据库

**状态：已在源码自动化解决；`0.3.0` 是 breaking wire contract。**

所有 write envelope 强制携带 `expectedCollaborationInstanceId`，该字段参与 canonical payload hash。插件在任何 mutation 或 receipt 创建前与 SQLite 权威 instance id 精确比较；`plan.create`/`run.clone` 和 session mutation 只绑定权威实例。首次与 replay 响应均返回实际 `collaborationInstanceId`，Desktop codec 要求与请求 expected id 完全一致。旧 `0.2.x` envelope 不被静默迁移，实例变化后的排队请求也不自动改绑。

### BUG-18 - 计划修订只检查当前 WorkItem，历史执行可回写新图

**状态：已在源码自动化解决。**

`CurrentPlanScopeRepository` 统一 current plan pointer、READY dispatch、活动并发、全部 required settlement、上游 Evidence 与历史实体拒绝。`plan.revise` 在事务前预检并在写事务内复核整个 Run 的所有 PlanRevision，以及 Planner/Worker/Synthesizer 的活动或 `UNKNOWN` Attempt；只有全局 quiescent 才能切换 current plan。历史 WorkItem RPC 被拒绝，旧 Worker/Synthesizer 的迟到完成转为 `ABANDONED`/事件审计，不提交 Evidence、FinalArtifact，也不推进当前计划；旧计划不会被伪改成 `WAIVED`。

### BUG-19 - Maintenance lease 过期后可能自动开放或重复报警

**状态：已在源码自动化解决；24 小时故障注入仍开放。**

`MaintenanceLeaseSpecification` 对 lease 进行有界严格解析，Repository 以 SQLite CAS 区分 `ACTIVE/EXPIRED/MALFORMED`。ACTIVE 过期时 gate 保持关闭，排队 command 被关闭，并为每个活动 Run 幂等写一次 `MAINTENANCE_LEASE_EXPIRED` 事件与 Intervention；重复 status/capabilities/restart 不复制诊断。退出必须同时匹配精确 lease id 和持久化的稳定 Desktop owner，foreign Desktop 不能释放；45 分钟租约覆盖 Rust 35 分钟绝对更新窗口，Desktop 在 mutation 使用点再次读取状态并要求至少 37 分钟剩余，其中 30 分钟给 package/fallback、5 分钟给 Gateway 恢复与最终版本核验、2 分钟留给 IPC/回连/精确 lease release。普通完成路径不会释放 `EXPIRED` lease，只有显式 recovery 才能清理。malformed 或短租约同样 fail closed，不删除持久事实。

### BUG-20 - OpenClaw runtime Promise 永不 settle 会卡死 controller

**状态：已在源码自动化解决；长时间 soak 仍开放。**

`FixedRuntimeDeadlinePolicy` 与 Deadline Decorator 为 Origin read、Flow、Agent、Task lookup/wait、Session messages、cancel 和 transcript append 配置 operation-specific 上限。超时产生结构化 `RUNTIME_TIMEOUT`，清理 timer 并吸收迟到 resolve/reject，shutdown 也能终止等待。可能已经产生副作用的 timeout 继续使用原 effect key 和 `UNKNOWN` 对账，不能因为本地 deadline 自动重发。

### BUG-21 - OpenClaw canonical 消息 ID 与 block 内容导致身份丢失或 UI 崩溃

**状态：已在 Desktop 自动化解决；浏览器视觉 QA 仍开放。**

history Anti-Corruption Layer 优先读取 `message.__openclaw.id`，仅兼容 fallback `id/messageId`，并拒绝越界或含控制字符的身份。字符串和 block-array `content` 均归一成纯文本供领域/UI 使用，同时把原始 blocks 保留为 `rawContent` 供 tool/thinking 解析；既有本地 cache 也在加载时迁移。这样不会把数组传给 `.trim()` 或 React 文本节点，也不会为了文本显示丢失结构化块。

### BUG-22 - Partial 接受后仍可能错误关闭存在独立活动工作的 Run

**状态：已在源码自动化解决。**

`SettlementSpecification` 将“当前 plan 的 required WorkItem settlement”和“全 Run 的 active/UNKNOWN Attempt quiescence”拆成两个可测试谓词。Partial 只允许在它声明的 waiver closure 内接受；不相关的 Worker 仍在运行时，不会被误判为合成就绪，也不会先把 Run 写成终态。`enqueueSynthesis` 还有第二道 readiness assertion，`transitionRun` 对 `COMPLETED/CANCELLED/FAILED` 统一拒绝 active/UNKNOWN Attempt。这样 A 节点的 partial 不会吞掉仍在执行的 B 节点。

### BUG-23 - Maintenance 过期可能遗留无法结算的 Planner/Worker/Synthesizer 或 Delivery

**状态：已在源码自动化解决；24 小时故障注入仍开放。**

`TerminalAttemptCompletionPolicy` 用 Attempt kind 到 active Run phase 的显式映射，只接受精确的 `resume_status`；维护过期导致本地 phase 冻结时，terminal result 先在同一事务桥接到对应 active phase，再按正常终态 CAS 结算，状态不匹配一律保持 Intervention。Delivery 在 transcript append 前再次检查 maintenance gate，命中时使用同一个 effect key 持久 defer，且不消费业务失败预算。维护恢复后原 command 可以继续，不能靠人工猜状态，也不能产生第二个 Attempt/Delivery。

### BUG-24 - Export sidecar 失败污染交付中的 Run 状态

**状态：已在源码自动化解决。**

Export 是只读审计旁路，不属于 Run orchestration state machine。真实 `EXPORT` job 失败后只更新 `export_jobs` 并立即返回；不得写 `COMMAND_FAILED`、不得把 `DELIVERY_PENDING` 改成 `AWAITING_INTERVENTION`，也不得阻断原 Delivery effect。回归覆盖“维护期间 Delivery defer + 超大导出失败 + 维护释放 + 原 transcript 只写一次 + Run 完成”的完整链路。

### BUG-25 - 远端 OpenClaw Task 未确认终止时的残余执行风险必须可见且不可误删

**状态：已在源码自动化解决；这是明确的受控例外，不是 quiescence 证明。**

`ResidualExecutionRiskSpecification` 只允许在 Run=`CANCELLING`、Attempt=`UNKNOWN`、用户显式接受风险、没有可执行取消命令，并且存在已开始取消 effect 或有效 `last_reconciled_at` 时将 Attempt 标记 `ABANDONED`。本地 Run 可以进入 `CANCELLED`，但正交的 `reconcileState` 固定为 `ATTENTION_REQUIRED`，并持久化包含 OpenClaw run/task、owner/child session、终止语义、actor、时间和 decision/event/intervention 的审计证据。此路径保留风险提示，禁止迟到结果写 Evidence/Artifact，禁止 redispatch，并阻止 clone、delete 和 retention；同一 session 仍可创建新的 Run。普通取消仍要求远端 Task 终止确认，只有该显式路径允许本地终态与未知远端 Task 并存。

### BUG-26 - 显式 stop 后 Worker 终态擦除恢复入口

**状态：已在源码自动化解决。**

`stopDispatch` 建立的是持久的 `DISPATCH_STOPPED` Intervention，而不是一次性的内存暂停标记。此前 Worker 在该窗口内返回成功时会把 Run 恢复成 `RUNNING + STOPPED`，同时留下未解决 Intervention；后续既不能 `DISPATCH_RESUME`，也不会调度依赖 WorkItem。现在 `WorkerPhaseRestorationPolicy` 将未解决 Intervention、partial decision、maintenance 和 session mutation 统一视为 phase fence：Worker 结果可以完成 Attempt/WorkItem，但 Run 保持 `AWAITING_INTERVENTION`、`resume_status=RUNNING`，直到显式恢复解析该 fence。策略按 fence 固定顺序返回，便于审计和测试。

**回归：**普通 stop → Worker 成功 → `DISPATCH_RESUME` → 下游 Worker 调度完整通过；未解决 stop Intervention 始终保留，不能被迟到结果隐式清除。

### BUG-27 - Partial 决策期间的写入与计划漂移

**状态：已在源码自动化解决。**

Partial 选择现在由 `PartialDecisionSpecification` 做有界、非空、去重、规范化校验；确认 token 和 durable `PARTIAL_PENDING` decision 同时绑定精确 `planRevisionId`。pending decision 对 WorkItem input/cancel/retry/reassign 和 plan revise 形成统一写栅栏，并在事务内二次检查。持久 payload 通过严格 codec 解码，拒绝错误 JSON、错误类型、重复/越界/交叠 ID；应用前按当前 plan DAG 重算 closure 并精确比对 descendants。任何腐坏或闭包漂移都会原子 supersede decision、写 `PARTIAL_DECISION_CORRUPT` Intervention/Event，不会静默 WAIVED 或无限重试。Partial closure 还从当前 plan 的活动 Attempt 聚合（包括 `UNKNOWN`），不会把“WorkItem 已需介入但远端 Task 仍未决”的执行误报为可 waiver。

**回归：**空选择、UNKNOWN active closure、pending 期间 WorkItem mutation/plan revision、以及 plan revision 变化后的 durable decision 均 fail closed，未产生新 Attempt 或错误 synthesis。

### BUG-28 - UI 猜测 `ABANDONED` 授权导致后端必拒

**状态：已在源码自动化解决。**

`ABANDONED` 不是“Run=CANCELLING 且 Attempt=UNKNOWN”就自动可用的普通动作。服务端 Attempt snapshot 现在投影 `canAbandonWithResidualRisk`，复用 `ResidualExecutionRiskSpecification` 的全部事实：没有 PENDING/LEASED cancel command，且存在已启动取消 effect 的持久证据或有效 reconciliation timestamp。wire 字段可选以兼容旧插件，但缺失默认 `false`，非布尔值直接拒绝；事务内授权仍由服务端再次检查。Desktop `runActions` 和 Dialog 只接受该投影，不再自行推断。

**回归：**CANCELLING+UNKNOWN 但缺少取消证据时 UI 不展示 `ABANDONED`；合法证据投影为 true 后才显示，并仍要求显式 residual-risk confirmation。

## 4. 已解决的 P1 风险

- History cursor 使用不可变 `(created_at,id)` snapshot boundary；controller 活动扫描不复用 UI 500 条上限。
- WorkItem input 精确绑定下一 Attempt 一次；retry 不重复消费。
- WorkItem cancel 和 UNKNOWN resolution 均要求 entity revision，并触达真实 Task。
- 外部 receipt 绑定 `commandId + source + payloadHash`；每 Run 4,096 普通额度外保留 64 个终止恢复槽位。
- Clone 只校验调用者原 envelope 一次，并记录 `sourceRunId` 与 `RUN_CLONED`。
- Tombstone read RPC 只暴露删除审计和 cleanup 状态，不泄漏已删除业务内容。
- Flow abandonment tombstone 字段作为一组完整证据校验并在历史抽屉展示；残缺组合按无效响应处理。
- Retention 宽候选使用稳定 `(ended_at,id)` cursor，未耗尽不按 24 小时重置，page/time-budget 截断安排近时 continuation；终态候选及 Run-scoped policy facts 均有专用索引，永久 blocked 前缀不能饿死后续可删除 Run。
- 删除 snapshot 对 status、reconcile state、时间、布尔 facts、Flow identity/revision 做严格持久化解码；损坏数据返回 `INVALID_RESPONSE` 而不是用 `0/null` 放行。
- 40 个 `junqi.collab.*` RPC 的唯一注册、scope、一次响应、service unavailable 和错误边界均有自动化覆盖。
- Capability response 明确 `behaviorVerified=false`，只作为声明和结构健康证据。
- 写 RPC 使用 Instance Identity Specification，授权使用 Effective Authorization Specification，current-plan 查询使用 Repository 聚合边界，runtime await 使用 Deadline Strategy/Decorator；这些模式分别承载可测试的不变量，不是仅有类名的抽象。
- maintenance recovery 使用严格 Specification + CAS Repository；事件/Intervention 幂等与 gate fail-closed 是数据库合同，不依赖 Desktop 计时器。
- Chat history 通过 Anti-Corruption Layer 将 OpenClaw canonical identity/content blocks 转为稳定领域模型，避免协议形态泄漏到 React 与协作身份。
- `SettlementSpecification`、`TerminalAttemptCompletionPolicy`、`WorkerPhaseRestorationPolicy`、`PartialDecisionSpecification`、`ResidualExecutionRiskSpecification` 和 export sidecar 隔离共同把 partial、maintenance、显式 stop、远端 Task 风险和审计导出建模为独立的 Specification/Policy，而不是散落的状态判断。

## 5. 数据与版本事实

- Plugin version：`0.3.0`。所有写 envelope 新增必填 `expectedCollaborationInstanceId`，所有写响应含权威 `collaborationInstanceId`；这是破坏性 wire 变更，不声明 `0.2.x` receipt/envelope 兼容。
- Physical schema：`11`。
- v7 migration 增加 `commands.available_at` 与 `commands_available(status, available_at, lease_expires_at, created_at)`；v8 增加 `failure_count`；v9 增加 `effect_started_at`；v10 增加 tombstone Flow reconciliation abandonment 证据字段；v11 增加 tombstone 的 authoritative `deletion_job_id`，让恢复只更新精确删除任务。
- Outbox 状态：`PENDING -> LEASED -> SUCCEEDED | FAILED | UNKNOWN | CANCELLED`。
- `attempts` 是 lease/CAS 代际；`failure_count` 是 FailureRetryPolicy 的业务失败预算；`available_at` 是最早重领时间；`effect_started_at` 是可能已开始外部效果的持久意图，不是成功回执。
- PROVISION/FLOW_SYNC 自动重试有界；人工 `RECONCILE` 是达到上限或终态冲突后的业务闭环。
- OpenClaw persistent Task 是 Agent 执行权威；SQLite 是协作领域、人工决定、交付和审计权威；Managed Flow 只是 Run 级镜像。

## 6. 剩余发布门槛

- [x] 当前源码 bundle 的 metadata、Tauri resource 与 archive 实算一致；plugin `0.3.0` / schema `12` / 155 个文件，SHA-256：`62fa1fcacf338b7f4e735f2726b999f4640a5db5de3f2f0fbfe492e11dc6c6fe`。
- [ ] 当前 `62fa1fca...` bundle 在固定 digest 的 OpenClaw `2026.7.1` 隔离容器中完成 structural P0-01；现有 evidence 只绑定上一版 `bea9b0ac...`。
- [ ] 当前 bundle 在隔离真实 Gateway 完成 behavioral P0-02/03/05/06/07/08；现有 evidence 只绑定上一版 `bea9b0ac...`。P0-04/09/10/11/12/13/14 也仍未验证。
- [x] 外部 evidence validator 已升至 policy v7 / P0-14 proof schema 3：除 exact `METHOD_NOT_FOUND`/`INVALID_REQUEST`、no-plugin + durable `ABSENT`、每个 mutation/unguarded maintenance 的 use-point re-probe、effect 计数和五个 target 级独立负向 fixture 外，还必须提供物理 `P014_TRACE` artifact；validator 以 canonical claims digest、workflow run/attempt/case、artifact bytes/SHA-256 和 canonical JSON 逐层复核，并拒绝 BOM 等第二种字节表示。它仍不把当前 partial evidence 升级为真实 P0-14 通过。
- [ ] 真实验证 P0-04/09/10/11/12/13/14，包括 session rebound、Desktop-exit continuity、Managed Child、portable/trusted 边界、Workboard false、reset/delete capability 分离和缺失 RPC 的 durable-state absence 语义。
- [ ] 完成 Chat 协作工作台桌面/移动浏览器视觉与交互 QA。
- [ ] 完成至少 24 小时 restart、fault injection、安全和 soak 测试。
- [ ] 以远端 `main` 最新基线完成三方整合，并完成 updater manifest、可信 default-branch promotion、`main`/tag ruleset、required-reviewer environments 和签名 secret scope；当前分支不能直接作为生产候选。
- [ ] 正式 Gateway/visual/soak producer 与 release validator 的文本 evidence scanner 范围已明确且实际执行；quality JSON、structural smoke 和 binary 内容的未扫描/OCR residual 仍须有明确接受标准。
- [ ] Attestation 证明解析并绑定选定 producer 的 run id/attempt，且 controller 身份与目标 release tag/source 身份完成双绑定；soak/Linux runner 不能只以 repo boolean 声明代替 JIT/online/一次性证明。
- [ ] 配置 immutable tag ruleset、唯一 promotion writer 和 protected environment，消除最后一次 tag/release 检查后的远端并发写窗口。

在这些门槛完成前，只能表述为“源码自动化闭环已通过，真实 Gateway/生产发布验收未完成”。
