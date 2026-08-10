# Gateway 原生能力与扩展一致性审计

日期：2026-08-10

## 权威依据

- OpenClaw 官方仓库远端主线提交：`5c308e0ebacfa92a9992d77f342facd0bbcef90e`。
- 核心方法目录：`src/gateway/methods/core-descriptors.ts`。
- 审计活动协议：`packages/gateway-protocol/src/schema/audit-activity.ts`。
- 基础审计协议：`packages/gateway-protocol/src/schema/audit.ts`。
- JunQi 协作扩展注册表：`packages/junqi-collab/src/rpc.ts`。

本地 OpenClaw 工作树仍停留在较早提交，本次只更新并读取 `origin/main` Git 对象，没有改动官方仓库工作树。

## 调用图结果

- 最新官方核心描述符包含 348 个方法。生产源码 AST 可直接解析出 164 个请求点、118 个不同方法：
  115 个属于官方核心，`browser.request` 属于官方内置 Browser 插件，2 个属于 JunQi 协作扩展，未知方法为 0。
- 参数化 requester 端口和动态动作分派不能仅靠字面量统计证明；本轮继续按其常量注册表、调用方和处理器逐项核对。
- 协作插件注册 42 个 `junqi.collab.*` 扩展 RPC。其中 39 个能在桌面生产代码找到真实消费者；
  `junqi.collab.session.mutationImpact`、`junqi.collab.session.mutation.prepare` 和
  `junqi.collab.session.mutation.complete` 没有桌面请求客户端，后两项只残留在 TypeScript 方法名联合中。
- `junqi.collab.instance` 只用于本地实例身份不一致错误，不是 Gateway 请求或插件注册项。
- 官方主线相对上次审计快照新增 `sessions.catalog.startTerminal` 与 `worker.desktop.observe`，并将 `fs.listDir` 改为动态权限；JunQi 当前没有调用这三个方法，因此不需要增加猜测性入口。
- 官方主线随后以提交 `bab4546b4189b1c16f319f338a7ac4802e259141` 删除 10 个无活跃处理器的 RPC。JunQi 曾消费其中
  `doctor.memory.remHarness`、`talk.session.cancelTurn`、`voicewake.routing.set` 和 `sessions.compaction.get`；其余 6 个方法没有发现 JunQi 生产调用。

## 已确认问题

### GNE-33 高：合法审计活动被严格解码器拒绝

官方 `AuditActivityInboundMessageV1Schema` 允许成功入站消息使用 `active_run_injected` 作为 `reasonCode`。JunQi 的 `OpenClawAuditClient` 没有接受该值，真实 Gateway 返回该记录时，整个分页响应会被判为无效。

整改要求：协议解码器必须接受官方封闭联合中的全部当前值，并以回归测试覆盖该分支；不得放宽为任意字符串。

### GNE-34 高：富审计客户端保留旧查询兼容回退

`OpenClawAuditClient` 先请求 `audit.activity.list`，收到未知方法后再请求 `audit.list`，并把两种不同协议投影成同一可选字段模型。仓库已经另有只面向 `audit.list` 的基础审计查询，富审计客户端的回退没有独立消费者需求。

该双轨路径存在三个问题：

1. 把两个正式但语义不同的协议当成新旧替代关系。
2. 让业务审计页在缺少消息审计能力时静默降级为不完整数据。
3. 在一个文件中混合富审计请求、两套协议解码和兼容选择，扩大职责与测试面。

整改要求：富审计客户端只调用 `audit.activity.list`；官方明确返回未知方法时显示不可用。`audit.list` 继续由基础审计模块独立消费，不作为回退。

### GNE-35 中：审计请求和协议解码职责未隔离

`OpenClawAuditClient.ts` 同时定义领域类型、请求参数、活动事件解码、旧事件解码和兼容策略。文件超过 450 行，协议漂移测试难以只针对纯 wire 边界。

整改要求：提取无状态的活动审计 codec，客户端只负责参数校验、请求和错误映射。复用依赖注入的 requester 端口，不增加服务定位器、继承层级或无消费者抽象。

### GNE-36 高：客户端继续调用上游已删除的 RPC

官方主线已经删除 `doctor.memory.remHarness`、`talk.session.cancelTurn`、`voicewake.routing.set` 和
`sessions.compaction.get` 的描述符、Schema 与处理器。JunQi 仍保留请求、状态、可编辑界面或外观方法时，真实最新版 Gateway 会返回未知方法；版本判断或回退不能恢复不存在的官方语义。

整改要求：删除四条调用链及其专属类型、状态、界面、国际化和测试；保留仍有官方契约的 memory status、
`talk.session.cancelOutput`、`talk.session.close`、`voicewake.routing.get`、compaction list、branch 和 restore。

### GNE-37 中：内存诊断存在重复解码器和无消费者 Hook

`OpenClawMemoryDiagnosticsClient.ts` 与 `memoryDoctor.ts` 分别维护相同领域的状态解码和错误模型，页面还保留一个无运行时消费者的诊断 Hook。上游删除 REM 后，第二条实现只会扩大协议漂移和无引用代码面。

整改要求：以 `OpenClawMemoryDiagnosticsClient` 作为 `doctor.memory.status` 的单一请求与解码边界，删除重复模块、无消费者 Hook、外观导出和专属测试。

### GNE-38 中：语音唤醒路由界面暴露不存在的写能力

最新版官方协议只保留 `voicewake.routing.get`。JunQi 的可编辑路由表和保存按钮会暗示用户能够写入 Gateway，但上游没有对应方法。

整改要求：路由投影改为只读，删除保存状态、写入客户端方法和编辑专属文案；未知或空路由保持真实只读状态。

### GNE-39 低：会话目标守护测试残留已删除外观

`OpenClawSessionTarget.test.ts` 仍调用已经从 Gateway 外观删除的 `getSessionCompactionCheckpoint`。该残留不形成生产请求，但会让类型检查和完整测试失去一致性。

整改要求：删除该断言项；branch、restore 和 list 的会话目标守护继续保留。

### GNE-40 中：定时任务契约落后于官方日期边界和状态模型

最新版官方 `CronScheduleSchema` 将 `everyMs`、`anchorMs` 和 `staggerMs` 限制在 ECMAScript Date 可表示的
闭区间内，定时任务状态和作业时间戳也复用相同上限。JunQi 的创建参数构造器不校验该边界，响应解码器只校验
安全整数，因此会发送官方必然拒绝的请求，也会接受官方 Schema 不可能返回的作业时间戳。

JunQi 还在创建契约和读取投影中重复定义 schedule、session target 和 wake mode，并保留官方主线已删除且全仓无
消费者的 `startupCatchupAtMs`、`pacedNextRunAtMs`、`forcePreservedNextRunAtMs`、`queuedAtMs` 与
`scheduleErrorCount`。这些字段构成无依据的旧协议表面。

整改要求：建立单一 Cron 协议类型来源；创建请求和官方日期字段共用同一上限；删除已失效且无消费者的状态字段，
不得以版本门禁或宽松解码保留旧模型。

### GNE-41 高：把握手方法列表误当作完整能力清单

官方 `hello-ok.features.methods` 是保守发现信息并且允许为空。JunQi 的会话历史能力读取器却要求该列表逐项包含
branches、switch、rewind 和 fork 方法，否则直接隐藏或禁用对应操作；协作安装状态读取和健康确认也要求列表包含
`junqi.collab.capabilities`。这些前置判断会在身份与连接均有效、RPC 实际可调用时制造错误的“不支持”状态。

整改要求：握手完成前保持不可用；完成认证连接后允许调用最新版官方已定义的会话历史 RPC，并只依据该次 RPC 的
结构化成功、未知方法、未授权或失败响应收敛状态。不得使用版本号或 `features.methods` 缺项提前拒绝。

### GNE-42 高：附件限制写死且忽略 Gateway 握手策略

最新版官方 `hello-ok.policy.attachments` 可选返回 `maxBytes` 与 `maxImageBytes`。官方客户端文档明确要求客户端在
每次重连后重新读取这两个逐附件上限，不得写死；该字段缺失时应发送请求并处理服务端结果。每条消息的附件数量、
MIME 接受范围和附加处理仍由服务端决定，不能由连接级客户端猜测。

JunQi 当前忽略该握手字段，并在 `attachments.ts` 写死 10 个附件、图片 6 MiB、普通文件 20 MiB、总计 50 MiB；
`desktopFileRuntime.ts` 又独立写死 20 MiB 并把超限或读取失败静默折叠为 `null`。运行时配置低于这些值时，客户端会
先接受服务端必然拒绝的文件；运行时配置高于这些值时，客户端又会拒绝服务端明确允许的文件。

整改要求：连接层严格解码并暴露当前 socket 的附件策略；附件准备、桌面文件读取、主会话和 Quick Chat 共用同一
策略对象。只校验官方声明的逐附件上限和必然受 `maxPayload` 约束的编码上限，删除数量与总量猜测；服务端响应仍是
最终事实。文件读取失败和超限必须是可区分错误，不得返回静默 `null`。

### GNE-43 高：Talk 依赖旧写权限兼容而未声明专用权限

最新版官方权限集合包含 `operator.talk` 和 `operator.talk.secrets`。Talk 会话方法要求 `operator.talk`；服务端目前
仍把 `operator.write` 作为旧客户端兼容权限，但官方源码把该分支明确归类为兼容行为。JunQi 的权限类型缺少 Talk、
Questions 和 Talk Secrets 三项，日常连接只请求 read/write，因此 Talk 会话和 `talk.event` 都依赖旧兼容分支。

整改要求：本地权限类型覆盖官方封闭集合；日常连接为实际使用的 Talk 能力显式请求 `operator.talk`，不得依赖
`operator.write` 兼容。未使用的 `operator.questions` 和 `operator.talk.secrets` 只进入类型契约，不扩大默认授权。

### GNE-44 高：协作会话变更扩展没有消费者且重新定义原生生命周期

已处理。删除三个 `junqi.collab.session.mutation*` 注册项，以及专属 prepare、complete、租约、数据库表、调度暂停、
运行恢复、干预、收据和测试状态机。协作插件数据库升至 schema 15；既有 schema 14 数据库会因当前版本结构校验
失败关闭，既不静默迁移，也不自动删除历史数据。当前数据库测试同时断言这两张旧表不存在。

OpenClaw 原生 `sessions.delete` 与 `sessions.reset` 仍是会话生命周期权威；桌面侧已有的原生请求守卫和运行结果核验
不属于协作插件状态机，继续保留。

### GNE-45 低：Workbench Provider claim 双端实现没有生产入口

已处理。删除前端 claim 领域、Store 状态、IPC 客户端及专属测试；同时删除 Rust claim/release command、内存表和
PTY 清理钩子。`probe_workbench_providers` 继续提供已审核 provider 二进制的可用性探测，智能体工作区仍是其唯一消费者。
这次删除不改变 PTY 创建、关闭、终止或退出事件的生命周期。

## 当前一致项

- 生产代码静态可解析请求没有发现未知方法；`browser.request` 已按官方内置插件能力单独分类，不误报为核心方法缺失。
- 保留的 39 个协作扩展均有桌面生产消费者；插件不再定义会话删除或重置的平行生命周期。
- 最新官方会话行已删除 `icon`，JunQi 当前未读取或写入该字段。
- 最新官方任务建议接受参数增加可选执行模式，JunQi 当前未提供该能力，不需要虚构默认策略。

## 验证结果

- 协作插件类型检查与完整插件测试通过；schema 15 创建不含已删除表，schema 14 既有数据库按设计失败关闭。
- `pnpm collab:validate` 通过，生成的协作插件包契约与 schema 15 一致。
- `pnpm lint` 通过：模块边界扫描 921 个文件无违规，发布版本一致性与 TypeScript 类型检查通过。
- `pnpm test` 通过：2,759 个前端测试与 236 个脚本测试均无失败。
- `cargo fmt -- --check`、`cargo check --lib` 与 `cargo test --lib` 通过；Rust 库测试 683 项通过，2 项按既有标记忽略。
- `pnpm build` 通过，协作与钉钉插件均完成契约校验和打包，Vite 生产构建完成。
- 已执行 `git diff --check`；针对删除的协作会话变更扩展与 Provider claim 链路的精确引用扫描未发现残留消费者。原生会话 mutation gate 的引用因仍负责官方 `sessions.delete` 与 `sessions.reset` 的并发守卫而保留。

## 未验证边界

- 本轮静态审计不能证明每个请求在真实 Gateway 上具备当前身份和权限。
- 协作插件与钉钉插件仍需在受控真实 Gateway 中完成加载、请求和事件回放。
- macOS、Windows 和 Linux 的真实 WebView、凭据与进程生命周期不由源码比对证明。
- 参数化方法分派仍需结合完整测试和真实 Gateway 回放验证；字面量 AST 清单不能单独证明每条动态路径。
