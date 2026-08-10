# 项目交接状态

更新时间：2026-08-10

## 当前目标

全量核对 JunQi 的 Gateway 原生调用、正式插件扩展、Tauri IPC 暴露面与本地派生投影，确保客户端不伪造
OpenClaw 语义，代码边界、协议解码和测试均可验证。Tauri command 消费者矩阵、历史契约测试语义化、协作
schema 单一权威和 session mutation wire DTO 已完成；当前继续审查 UI 错误传播和剩余动态调用，真实 Gateway
回放与目标平台桌面验收仍是最终必需边界。

## 已完成内容

- `Blues-Code/dingtalk` 已通过合并提交 `4b7bb79f` 进入 `main`，其提交 `3dbd5c56` 已是 `main` 的祖先。
- 静态 Gateway RPC 复核确认 101 个生产代码字面量调用、81 个不同方法均能在 2026-08-09 获取的官方源码提交
  `03cb1443e5185d130b22d792a322cf7000eb4694` 的 core descriptor 中找到；16 个集中常量方法同样已核验。
  该结论不覆盖动态方法名、
  插件 RPC 或真实运行回执。
- `openclaw.setup.verify` 已复核为官方 `operator.admin` 只读验证方法，保持现有实现，不以其他方法替代。
- 实时 `agent`、`chat`、`session.tool` 事件已收束到纯解码器。畸形事件不会抢占 run 序号，Chat 仅接受
  官方封闭状态及必填字段，未知但完整的 Agent stream 不投影为聊天状态。
- 协作刷新提示只走 `event: "agent"` 和 `stream: "junqi-collab.changed"`；不存在的同名顶层 Gateway
  事件不再被客户端解释为协作能力。
- 运行时中的原始 `any` 事件入口、分散的 Chat 自定义 stream 分支和顶层媒体字段读取已删除；实时流、
  会话转录、工具流和非实时失效事件已分为独立处理职责。
- Tauri command 注册表已从 295 项收束到 272 项；每一项均有生产 WebView 或受控 Rust 注入页面消费者。
  无消费者的旧 PTY、旧文件目录列举、旧调试日志和专属测试已删除。
- 高风险 Tauri wrapper 已改用真实 invoke 载荷测试；直接字面量调用的 Rust 注册关系由独立守护测试覆盖，
  不再以 45 个源码文件和 132 条正则判断契约。
- 钉钉插件工具 manifest 现由编译后的运行时工具规格逐项校验，不再仅校验数量；源代码测试与包校验均通过。
- 协作插件已删除没有前端、运行时或外部消费者的 `junqi.collab.plan.get` Gateway 注册；其领域查询仍由
  `run.get` 内部聚合复用。
- 非聊天 Gateway 事件入口已从 `any` 收束为 `unknown`；仅对象载荷可读取会话失效字段，循环引用等
  未知载荷不会破坏日志路径或制造会话投影。
- 已删除失效的智能体资料源码文本守护；Tauri 调用捕获测试验证加载、保存、删除的实际参数，Rust 纯状态测试验证
  资料变更不会覆盖其他应用设置或其他资料。Gateway 停止只保留统一的 `stop_gateway` WebView 入口。
- 协作持久化已由 `CollaborationSchemaInitializer` 统一创建和校验 schema 14；历史迁移、双重删除回执、绝对
  导出路径重映射和候选删除作业收养均已删除。显式删除墓碑必须绑定权威删除作业。
- Session mutation impact 与 prepare 均使用显式 `runId` wire 身份和 event watermark；数据库内部 `id` 不再
  跨 RPC，插件服务和 Desktop coordinator 均有回归测试。
- 历史消息身份只读取 OpenClaw 当前 `__openclaw.id`，发送运行身份只读取顶层 `idempotencyKey`；旧顶层和
  元数据别名不再参与去重或运行收敛。
- 已删除客户端复制的模型可见性算法。配置页只判断可由静态配置证明的结构问题，模型目录、认证、别名和
  智能体作用域结果由 Gateway `models.list` 提供。
- 授权、配对、权限和限流分类只接受结构化错误码；WebSocket 关闭原因和普通错误文案不再生成授权事实。
- Gateway 请求超时已使用稳定错误类型，未知方法证据精确绑定当前请求方法；启动期历史预热不再解析错误文案。
- 原生 Gateway 客户端、技能运行时、数据仓和协作插件探测现共用 `GatewayProtocolEvidence`。三个非官方未知方法
  错误码、宽松文本和嵌套异常不再生成能力缺失；协作领域改用本地 `METHOD_UNAVAILABLE` 状态。
- 配置重载规划只读取当前 Gateway `config.schema.lookup`；查询失败使用稳定本地分类并失败关闭为重启，不再记录
  原始异常或按本机安装版本预置路径规则。
- 聊天发送失败不再按类名和英文消息判断 Gateway 状态。发送前的传输生命周期失败会收敛已创建的本地任务检查点；
  请求可能已经发出时仍保留待核验语义。
- 原生任务账本和审批 Store 在断连时不再制造英文操作错误；共享连接状态负责离线展示，本地兜底失败使用稳定领域码，
  多语言转换只发生在活动面板。
- `usage.cost` 与 `sessions.usage` 已由 `OpenClawUsageClient` 统一校验。分析页、仪表盘和智能体设置复用同一官方
  类型，已删除 `any`、双重断言以及模型、供应商和会话字段的猜测别名。

## 关键技术决策

- OpenClaw Gateway 协议、会话、运行、工具和插件事件是权威事实；JunQi 只保存可追溯的 UI 投影。
- 使用纯判别联合作为协议解码边界，使用 `OpenClawChatRunProjection` 作为 run 序号和终态围栏；不为单一
  消费者增加抽象基类、服务定位器或猜测性兼容层。
- 协作插件的自定义 stream 属于官方 `agent` 事件载荷，不属于 Gateway 顶层事件目录。
- Native 与 Docker、真实 Gateway 与本地测试、自动化验证与三平台真机验收必须分别记录，不相互推断。

## 核心文件

- `src/processing/openClawChatEvent.ts`：实时 Gateway 事件纯解码和 Chat 增量合并。
- `src/runtime/OpenClawChatEventRuntime.ts`：解码后的聊天、工具、转录与失效事件投影。
- `src/services/gateway/collaborationEventBridge.ts`：协作 Agent stream 观察者桥接。
- `src/services/gateway/messageIdentity.ts`：OpenClaw 历史消息与发送运行身份读取边界。
- `src/services/gateway/messageRouter.ts`：Gateway 结构化授权错误分类。
- `src/services/gateway/GatewayCapabilityRegistry.ts`：能力调用证据与失败状态记录。
- `src/services/gateway/GatewayProtocolEvidence.ts`：未知方法与当前请求身份绑定的单一协议证据解析器。
- `src/services/gateway/OpenClawUsageClient.ts`：OpenClaw cost 与 session usage 的结构、校验和页面类型来源。
- `src/services/chat/sendTransaction.ts`：聊天发送、投递不确定性与本地任务检查点收敛边界。
- `src/stores/openclawTaskLedgerStore.ts`、`src/stores/openclawApprovalsStore.ts`：原生活动数据与操作状态投影。
- `packages/junqi-collab/src/openclaw-adapter.ts`：协作插件通过官方 Agent stream 发出刷新提示。
- `docs/quality/gateway-native-extension-consistency-followup-audit-2026-08-09.md`：本轮协议审计、依据和边界。
- `specs/quality/2026-08-09-gateway-event-boundary-remediation.md` 与
  `plans/quality/2026-08-09-gateway-event-boundary-remediation.md`：当前整改契约与实施顺序。
- `docs/quality/tauri-command-consumer-matrix-2026-08-09.md`：Tauri command 消费者矩阵与删除依据。
- `src/api/tauriCommandsContract.test.ts` 与 `scripts/tauri-command-registry-contract.test.mjs`：可执行 IPC
  参数契约和注册关系守护。

## 测试与验证

- 已通过未知方法证据、配置重载、消息身份、授权、协作、技能、数据仓和会话生命周期定向测试 154 项。
- 已通过完整 `pnpm test`：前端与仓库脚本测试均通过，零失败。
- 已通过 `pnpm lint`：模块边界扫描 922 个文件零违规，四处桌面版本一致，TypeScript 检查通过。
- 已通过完整 `pnpm test:rust`：684 项通过、2 项忽略、零失败。
- 已通过 `pnpm build`：协作插件、钉钉插件契约与打包完成，TypeScript 和 Vite 生产构建通过并生成 `dist`。
- 已通过 `pnpm verify:openclaw-docs`。
- 已通过 `pnpm dingtalk:test`（18 项）、`pnpm dingtalk:validate`、`pnpm collab:test`（364 项）与
  `pnpm collab:validate`。
- 已通过 `pnpm collab:bundle`：schema 14、167 个校验文件，bundle SHA-256 为
  `0778a9538482e492b9acc8bb079dcec959e8546b07231de898f06138c1b9275f`，generated metadata 与 Tauri resource metadata 一致。
- 已通过 `src/stores/gatewayDataStore.test.ts`：29 项通过，覆盖未知载荷和安全日志边界。
- 已通过聊天发送、原生任务账本和审批 Store 定向测试：25 项通过；TypeScript 检查与 `git diff --check` 通过。
- 已通过 usage 解析、数据仓和分析查询定向测试：33 项通过；本轮 TypeScript 检查通过。
- 当前 macOS ARM64 主机已实际通过 `pnpm verify:openclaw-docs` 与 `pnpm test:rust`：684 项通过、2 项忽略。
- Docker 真实 Gateway 回放按当前任务要求停止，未将镜像拉取或容器启动结果计入通过结论。
- 已通过 `git diff --check`。
- 已扫描本轮修改后的完整文本文件及协作插件包内文本成员，未发现 Emoji。
- 测试输出仍包含 Node 的 `module.register()` 弃用提示，以及服务端渲染 Tooltip 的 `useLayoutEffect` 警告；
  二者均未造成失败，且不属于本次 Gateway/Tauri 边界改动。

## 当前未验证

- 尚未在官方提交 `03cb1443e5185d130b22d792a322cf7000eb4694` 对应的真实 Gateway 回放实时事件、协作插件和
  钉钉插件。
- 本轮未执行 Docker Gateway 回放；此前两次隔离 structural harness 均通过 bundle 校验和 Docker preflight，但固定摘要的
  OpenClaw `2026.7.1` 镜像在 600 秒拉取上限处超时，插件和 Gateway 尚未启动。两次均确认无受控容器、网络或 volume 遗留。
- 尚未完成 macOS、Windows、Linux 的凭据库、WebView、窗口和真实 UI 验收。
- Node 的 Tauri 内部桥不等于真实 WebView 到 Rust handler 的端到端调用；该路径仍需桌面真机验证。

## 失败方案与约束

- 不再在实时 payload 未校验时推进 run 序号，否则畸形事件会丢弃后续有效同序号事件。
- 不再接受 `junqi-collab.changed` 顶层 Gateway event；上游只提供 Agent stream 承载该插件刷新提示。
- 不将本机安装的 OpenClaw 版本、测试 fixture、Gateway token、开发机路径或 UI 状态视为跨平台协议事实。
- 不把镜像下载进度、Docker preflight 或历史版本 structural harness 当作插件兼容成功。

## 下一步顺序

1. 在受控最新版 Gateway 完成实时事件、协作插件与钉钉插件的真实回放。
2. 在 macOS、Windows、Linux 完成 WebView 到 Rust handler、凭据库、窗口与关键 UI 的桌面验收；
   未验证项继续保持明确边界。
