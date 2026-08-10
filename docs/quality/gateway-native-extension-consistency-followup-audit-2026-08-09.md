# Gateway 原生能力与扩展一致性复审

日期：2026-08-09

## 范围与依据

本次复审基于 `main` 的提交 `4b7bb79fcd4fa4ef4bb8c26241118b3528b75279`，覆盖 Gateway 实时事件、协作插件事件、首次启动模型核验、Tauri command 暴露面和相关契约测试。

上游依据是 2026-08-09 获取的 OpenClaw 官方源码提交 `03cb1443e5185d130b22d792a322cf7000eb4694`。源码以 Git 对象读取，避免将部分克隆误当作工作树。已核对：

- `src/infra/agent-events.ts`：Agent 事件必须含 `runId`、`seq`、`stream`、`ts` 和对象形态 `data`；stream 名允许扩展。
- `packages/gateway-protocol/src/schema/logs-chat.ts`：Chat 事件是 status、delta、final、aborted、error 的封闭联合；每个变体都要求 `runId`、`sessionKey` 与非负整数 `seq`。
- `src/gateway/server-broadcast.ts` 与 `src/gateway/server-methods-list.ts`：顶层插件广播只允许 `plugin.*`，Gateway 目录不包含 `junqi-collab.changed`。
- `src/plugins/agent-event-emission.ts` 与本仓库 `packages/junqi-collab/src/openclaw-adapter.ts`：协作插件通过 `event: "agent"`、`stream: "junqi-collab.changed"` 发出刷新提示。
- `src/gateway/methods/core-descriptors.ts` 与 `src/gateway/server-methods/system-agent.ts`：`openclaw.setup.verify` 是要求 `operator.admin` 的官方只读验证方法；其成功和失败结果与 JunQi 当前解析器一致。

## 已确认一致项

- 对生产前端静态调用的复核扫描识别出 101 个 Gateway RPC 字面量、81 个不同方法，均能在上述官方 core descriptor 中找到。16 个集中常量方法（`cron.*`、`tasks.*`、`tts.*`）也均有官方 descriptor。该结论不覆盖自定义插件 RPC、运行时能力或真实运行回执。
- `OpenClawSetupVerificationClient` 的 `ok/modelRef/latencyMs` 和失败 `status/error` 解析，与官方 `verifySetupInference` 结果一致；不得删除或以 `models.probe` 替代。
- 本次合入的钉钉工作台不新增 Gateway 顶层协议，且 dingtalk 提交已是 main 的祖先。

## 发现

### GNE-11 高：未解码实时事件先推进运行序号

位置：`src/runtime/OpenClawChatEventRuntime.ts` 的 `handleEvent`。

当前实现会在校验 `agent`、`chat` 和 `session.tool` payload 前调用 `OpenClawChatRunProjection.acceptEvent`。该投影会记住合法格式的 runId 与 seq；若 event 的 `data` 或 Chat state 随后被判为无效，同 seq 的有效事件将被序号栅栏拒绝。

影响：不可信或版本漂移的实时载荷能够造成流式文本、工具状态或终态投影缺失，且错误不应由本地投影补造。

整改：先以单一纯解码器验证 envelope 与变体，再仅对已解码的运行事件推进序号。未知但形态完整的 Agent stream 只维护顺序，不进入 UI 状态；畸形载荷不改变任何运行状态。

### GNE-12 高：协作刷新提示接受不存在的顶层 Gateway 事件

位置：`src/services/gateway/collaborationEventBridge.ts`。

插件实际使用官方 Agent stream。当前桥接器额外接受 `event: "junqi-collab.changed"` 的顶层载荷，官方 Gateway 只允许 `plugin.*` 作为顶层插件广播，因此该分支是无契约 fallback。

影响：JunQi 对不存在的 Gateway 事件作出可用性解释，违反客户端边界；测试和 runtime identity fixture 也错误地把该 stream 当作 Gateway event feature。

整改：仅接受完整的 `agent` envelope 与该插件 stream；删除 direct-event 分支、专属测试和错误 fixture 值。协作提示继续只作为权威 run 查询的触发器，不成为状态事实。

### GNE-13 中：Tauri command 最小暴露面尚无完整消费者矩阵

已完成整改。基线 `generate_handler!` 注册 295 个 command；经生产 WebView、Rust 内部、测试、插件、
capability 和文档引用核对后，移除 23 个无渲染层消费者的命令暴露，当前保留 272 个。271 个有生产
TypeScript、TSX 字符串消费者，`return_to_desktop` 则由受控 Rust 注入的控制页脚本调用。完整清单见
`docs/quality/tauri-command-consumer-matrix-2026-08-09.md`。

### GNE-14 中：Tauri 契约守护仍以源码文本为主

已完成整改。`src/api/tauriCommandsContract.test.ts` 不再读取业务源码，而是经 Tauri JavaScript 内部
invoke 桥捕获真实 command 和参数，覆盖 Gateway 生命周期、设备签名、钉钉操作、渠道、持久通知、语音和
媒体预览。`scripts/tauri-command-registry-contract.test.mjs` 只保留必要的静态关系：生产代码中的直接字面量
调用必须已在 Rust 注册表中出现，不再断言源码文本、函数位置或变量名。

### GNE-15 中：钉钉工具清单和协作 RPC 存在可漂移的扩展暴露面

已完成整改。钉钉插件原来的 package 校验只断言 manifest 中工具数量为 30，无法阻止清单名称和实际
`registerTool` 规格错位。校验现在直接导入编译后的 `tool-specs`，要求 manifest 工具数组按顺序完全一致；
源代码测试也守护同一运行时规格。

协作插件的自定义 RPC 则逐项与前端 `CollaborationClient`、写入方法联合和实际调用图比对。所有前端可达
方法均有 `COLLABORATION_RPC_METHODS` 注册；`junqi.collab.plan.get` 没有任何外部消费者，只是内部
`getRun` 聚合仍复用的领域函数。因此删除了该无消费者 Gateway 端点，保留内部查询函数。

### GNE-16 中：非聊天 Gateway 事件入口允许未类型化载荷进入状态逻辑

已完成整改。`handleGatewayEvent` 是非聊天事件进入数据投影的公共边界，原先使用 `any` 并直接读取
载荷字段；未知事件的日志路径还会对循环引用载荷抛出异常。该入口现在接收 `unknown`，复用既有对象记录守卫，
仅从对象载荷读取官方 `sessions.changed` 字段；其他形态只能触发既有的权威刷新，不产生本地会话状态。
未知事件日志改为受限、安全的载荷预览。回归测试覆盖空载荷和循环引用载荷，确认它们不删除、创建或改变会话投影。

### GNE-17 中：Tauri 收束后的旧守护测试仍依赖已删除接口和源码文本

已完成整改。`agentProfilesContract.test.ts` 仍要求已删除的 `save_app_settings` 文本片段，无法验证真实
IPC 参数或资料更新的状态语义；该测试已删除。原有 Tauri 调用捕获测试现在覆盖智能体资料的加载、保存、删除命令和序列化字段，
Rust 侧以纯 `apply_agent_profile` 状态变更测试验证更新资料不会覆盖其他应用设置或其他智能体资料。

`gatewayStopEntry.test.ts` 还要求 WebView 注册 `stop_docker_gateway`。运行时选择本就由
`stop_gateway` 在 Rust 侧统一分派，Docker 停止函数仅为内部实现；测试现明确守护单一公开入口，不再要求
多余 command 暴露。

### GNE-18 高：活动连接切换目标时产生 Gateway 身份漂移

位置：`src/services/gateway/Connection.ts` 的 `GatewayConnection.connect`。

当前实现先改写 `url`、Gateway token 和设备 token，再检查现有 socket 是否仍处于连接或握手状态。若调用方
在活动连接期间提交了另一个目标，方法会直接返回，旧 socket 继续承载请求，但连接对象保存的目标和下一次自动
重连凭据已经属于新 Gateway。

影响：当前连接身份、诊断地址、媒体基址和后续重连目标可能互相矛盾；断线后的自动重连还会无提示切到另一个
Gateway。该状态不能由请求栅栏修复，因为栅栏只核对已认证连接标识，不核对尚未发生的目标改写。

整改：把目标值对象作为连接状态的一部分。同目标且同凭据的重复连接保持幂等；目标或凭据变化时必须先完整失效
旧 socket、待处理请求、运行时身份和重试状态，再创建新 socket。回归测试必须覆盖已连接和握手中的目标替换。

### GNE-19 中：权限失败仍保留字符串兼容回调

位置：`src/services/gateway/Connection.ts`、`src/services/gateway/index.ts`、
`src/services/gateway/approvalEventBridge.ts` 和 `src/pages/QuickChatRoot.tsx`。

`onAuthorizationIssue` 已提供结构化的 `kind`、`code`、`missingScope` 和 `requiredScopes`，但连接层仍保留
`onScopeError` 字符串兼容回调，部分入口同时注册两者，部分入口只消费旧回调。这样会让同一官方错误在不同窗口
走不同状态路径，并丢失可操作的权限证据。

整改：删除 `onScopeError` 及其 fallback，所有连接消费者统一处理 `GatewayAuthorizationIssue`。同时删除只被
自身测试引用的 `isAuthError` 布尔包装，权限分类只保留单一结构化入口。

### GNE-20 中：内部 Gateway 状态事件仍接受旧字段别名

位置：`src/services/gateway/types.ts` 和 `src/services/gateway/GatewayStateMachine.ts`。

生产状态观察入口已经把进程存活与端点就绪分别投影为 `processAlive` 和 `endpointReady`，但状态机事件仍
接受 `running` 并优先级回退。该别名只剩测试消费者，使内部状态契约继续存在两种写法。

整改：`STATUS_RECEIVED` 必须显式携带 `processAlive` 和 `endpointReady`；删除 `running` 别名及
状态机回退，测试改为守护当前唯一契约。

### GNE-21 高：子智能体活动状态使用时间戳猜测

位置：`src/stores/gatewayDataStore.ts` 的 `isRunningSubagentSession`。

最新版 OpenClaw 的会话读取路径正式返回 `hasActiveRun` 和 `hasActiveSubagentRun`。当前实现若两者都缺失，
会根据 `status`、`running` 或最近一分钟的 `updatedAt` 猜测活动状态。

影响：不完整、缓存或旧会话行可能被错误展示为仍在运行，进而影响智能体活动列表和资源使用判断。客户端不能用
时间新鲜度替代 Gateway 的活动运行账本。

整改：只接受 OpenClaw 明确返回的两个布尔字段；字段缺失时保守显示为非活动，不推断运行事实。

### GNE-22 高：实例凭据缺失时回退到端点旧凭据

位置：`src/services/gateway/credentialProvider.ts` 的 `getGatewayDeviceCredentialForUrl`。

设备凭据从握手前端点槽绑定到运行时实例槽时，事务顺序已经保证先写实例凭据、再发布端点到实例的别名、最后删除
源凭据。因此正常中断不会发布一个尚未写入目标凭据的别名。现有读取函数仍在实例槽无 token 时回退端点槽，会让
过期或本应退休的端点凭据重新参与认证。

整改：别名一旦存在，只读取别名指向的实例槽；读取失败或无 token 时保留无凭据语义，由官方配对流程恢复，不再
尝试端点旧凭据。

### GNE-23 高：钉钉运行时失败被永久缓存且泄露宿主路径

位置：`packages/junqi-dingtalk/src/dws-runner.ts` 和
`packages/junqi-dingtalk/src/runtime-probe.ts`。

`DwsRunner.resolveExecutable` 会缓存包含失败结果的 Promise。若插件启动时尚未安装 DWS，后续在 JunQi 中完成
官方安装并重新检测，同一插件实例仍返回第一次失败，必须重启 Gateway 才能恢复。运行状态工具还把解析后的绝对
可执行文件路径返回给调用它的 Agent，扩大了不必要的宿主环境暴露。

整改：并发查找仍使用单飞，但只缓存成功路径；查找失败后清空飞行中状态，使重新检测能够看到新安装的 DWS。运行
状态只返回可用性、版本、授权和 Profile 投影，不返回宿主绝对路径。

### GNE-24 中：协作维护状态保留双轨线协议字段

位置：`packages/junqi-collab/src/service.ts`、`src/services/collaboration/MaintenanceCoordinator.ts`
和 `src/services/collaboration/wire-codec.ts`。

协作插件同时返回 `active` 和 `gateActive`，桌面端还要求两者完全一致。该做法让同一个维护门状态存在
两个线协议来源，任何一侧遗漏更新都会把有效响应变成矛盾响应；它也属于仓库规范明确禁止保留的兼容别名。

整改：插件 RPC 和 capabilities 投影只返回领域权威字段 `gateActive`。桌面端反腐层严格校验该字段后，
再映射为内部界面模型的 `active`；旧 `active` 线字段不再接受。维护进入、退出和状态读取使用同一契约。

### GNE-25 高：钉钉运行时错误把原始异常内容返回给 Agent

位置：`packages/junqi-dingtalk/src/errors.ts`、`packages/junqi-dingtalk/src/dws-runner.ts`
和 `packages/junqi-dingtalk/src/runtime-probe.ts`。

未知异常会以原始 `Error.message` 返回，DWS 启动失败会携带 `cause`，命令失败还会提取 DWS
响应中的任意错误文本。上述内容可能包含宿主绝对路径、命令参数、远端标识或凭据信息，并进入 Agent 可读工具结果。

整改：错误投影只接受已审查错误码，使用固定安全文案，并对白名单详情逐字段校验。未知错误码和普通异常统一映射为
`DWS_RUNTIME_FAILURE`，不返回原始消息。子进程启动和命令失败路径不再保存或提取原始错误文本。

### GNE-26 中：协作包校验器断言编译后私有函数名

位置：`packages/junqi-collab/scripts/validate-package.mjs`。

包校验器读取 `dist/service.js`，要求三个私有函数名存在并要求一个旧函数名不存在。函数名和内部拆分方式不属于
OpenClaw 插件清单、导出或 RPC 契约；该断言会让职责提取和重命名产生伪回归，也不能证明恢复行为正确。

整改：删除编译源码文本断言。包校验只保留 manifest、版本、导出、Node 与 OpenClaw 兼容范围、依赖、产物和
嵌套归档检查；恢复行为继续由可执行服务测试覆盖。

### GNE-27 高：协作任务、Attempt 和墓碑读取保留兼容双轨

位置：`packages/junqi-collab/src/service.ts`、`src/services/collaboration/wire-codec.ts` 和
`src/services/collaboration/client.ts`。

删除和导出任务由插件输出蛇形数据库字段，但桌面端同时接受蛇形与驼峰；Attempt 缺少执行运行时和残余风险字段时
静默补默认值；墓碑缺少 Flow 核验字段时自动补空值。这些路径让插件输出漂移、旧结构和不完整审计证据继续进入
当前领域模型。

整改：插件任务投影统一为驼峰字段，桌面端只接受这一结构。Attempt 的 `executionRuntime` 和
`canAbandonWithResidualRisk` 改为必填。墓碑只接受完整、无未知字段的驼峰结构；缺字段、蛇形别名或不一致证据
全部失败关闭。

### GNE-28 高：维护租约所有者同时受 Rust 文件和 WebView 存储影响

位置：`src/services/collaboration/MaintenanceCoordinator.ts`、`src/api/tauri-commands.ts` 和
`src-tauri/src/commands/collaboration_owner.rs`。

桌面端会把 WebView `localStorage` 中的旧所有者传给 Rust，Rust 在首次创建安装级文件时收养该值，并返回
迁移专属的 `adoptedLegacy` 字段。维护租约身份因此存在浏览器存储和原生文件两个来源，IPC 还保留只为旧迁移
服务的参数和结果字段。

整改：Tauri 运行时只调用无参数 command，Rust 只生成或读取安装级稳定所有者文件。删除迁移参数、迁移分支、
迁移结果字段和专属测试；并发首次创建仍通过原子文件激活收敛到一个所有者。非 Tauri 测试环境的浏览器内存实现
不参与桌面权威身份。

### GNE-29 中：Gateway 与协作回归测试守护源码写法而非可执行契约

位置：已删除的 Gateway 回归测试、协作集成测试和插件包私有源码断言。

部分测试通过读取 TypeScript、Rust 或编译后 JavaScript 文本，断言函数名、局部表达式或调用顺序。此类测试在
职责提取、私有重命名或等价实现后产生伪回归，却不能证明 IPC 载荷、状态转换、权限失败或运行恢复行为。

整改：删除无可执行行为覆盖的源码形式测试。Gateway 生命周期、连接身份、配置重载、凭据、安全停止和协作 wire
改由纯状态机、真实 invoke 捕获、公开产物校验或服务级运行测试守护；静态测试仅保留注册表、manifest 等必须由
源码结构表达的发布契约。

### GNE-30 高：维护租约接受无版本持久化状态并推断为活动

位置：`packages/junqi-collab/src/maintenance-lease-specification.ts`。

维护租约解析器在 `version/status` 同时缺失时把记录解释成 `ACTIVE`。这会让未版本化数据绕过现行状态契约，并由
客户端推断一个 Gateway 维护事实。

整改：持久化租约必须精确包含 `version: 1` 和受支持的 `status`。无版本、未知版本、字段缺失或额外字段均投影为
`MALFORMED`，保持维护闸门开启并要求人工恢复；不升级、不补字段、不猜测活动状态。

### GNE-31 高：协作数据库、删除回执和恢复身份存在多套历史权威

位置：`packages/junqi-collab/src/database.ts`、`database-schema-initializer.ts`、`schema.ts` 和 `service.ts`。

数据库启动同时执行现行建表和逐版本迁移，新库与升级库可能形成不同结构；删除命令同时维护统一回执与删除专用
回执；导出制品接受绝对路径重映射；删除墓碑无作业引用时还会按同 Run 候选作业推断恢复所有者。上述路径让
当前运行事实依赖历史数据形态和客户端猜测。

整改：提取 `CollaborationSchemaInitializer` 作为 Schema 生命周期单一职责组件。新空库只创建 schema 14；已有
库必须精确匹配版本、表、索引、列、外键和结构形状，否则在写入前失败且不修改原库。删除专用回执与冲突表已
移除，`command_receipts` 成为唯一回执权威。受管导出只接受当前 JSON 制品标识。显式删除墓碑必须绑定唯一
`deletion_job_id`，恢复只核对该身份；缺失、错配或持久化矛盾保留 `PARTIAL` 证据，不收养候选作业。

### GNE-32 高：session mutation impact 将数据库实体字段泄露到 wire

位置：`packages/junqi-collab/src/service.ts` 的 `sessionMutationImpact` 与
`src/services/collaboration/wire-codec.ts` 的 session mutation decoder。

当前客户端解码器要求跨边界运行引用使用稳定的 `runId`，而插件 impact 直接返回数据库查询对象，使用内部的
`id` 字段。prepare 响应已经使用 `runId`，这会让同一流程的 impact 与 prepare 形状不一致；严格客户端会在删除或
重置前拒绝 impact，导致操作无法进入策略判定。

整改：由服务层提供单一 session mutation wire DTO 投影，先应用与 `listRuns` 相同的 allowed action 装饰，再将
数据库 `id` 显式映射为 `runId` 并附带权威 event watermark。DTO 不包含数据库内部 `id`；前端保持严格解码，
不接受两种字段名。插件服务测试和 Desktop coordinator 测试覆盖该边界。

### GNE-33 高：消息身份读取保留未声明的顶层别名

位置：`src/services/gateway/messageIdentity.ts`。

最新版 OpenClaw 的 `chat.history` 消息使用 `__openclaw.id` 作为历史消息身份，并在顶层使用
`idempotencyKey` 关联一次发送运行。当前实现仍接受顶层 `id`、`messageId`、`clientMessageId` 以及
`__openclaw.clientMessageId` 等未声明别名，导致任意消息字段可被误当作权威身份参与去重与运行收敛。

整改：历史消息身份只读取 `__openclaw.id`，客户端运行身份只读取顶层 `idempotencyKey`；保留官方当前使用的
用户、助手与 CLI 运行后缀归一化。删除旧别名测试，增加别名不能生成身份的失败关闭回归。

### GNE-34 高：模型配置页复制旧版可见性算法并产生错误门禁

位置：`src/services/gateway/modelVisibility.ts` 与 `src/pages/ConfigManager/modelRoutingHealth.ts`。

最新版 OpenClaw 的模型可见性由智能体作用域、别名、显式策略、主模型、回退模型、插件归一化、运行时认证和
实际模型目录共同决定。当前配置页只读取 `agents.defaults.models`，并按旧固定版本规则自行推断主模型和回退模型
是否可见；合法配置会被误报，且本地结果不能代表 `models.list` 的权威目录。

整改：删除客户端复制的模型可见性算法及其专属测试。静态配置健康检查只保留无需运行时事实即可证明的结构约束；
模型是否可见或可选由 Gateway `models.list` 的结构化结果呈现，不再由配置页猜测。

### GNE-35 高：授权分类与连接关闭仍从英文文本推断状态

位置：`src/services/gateway/messageRouter.ts` 与 `src/services/gateway/Connection.ts`。

当前分类器除 `error.details.code` 和外层 `code` 外，还使用错误文案正则推断配对、凭据、权限与限流；连接关闭时
又将 WebSocket `reason` 重新送入分类器。文案不是稳定协议字段，普通关闭原因可能错误进入配对重试，未知错误也
可能被伪装成已识别授权状态。

整改：授权分类只接受 OpenClaw 正式结构化错误码。WebSocket 关闭不生成授权事实；配对状态只由握手或 RPC
结构化错误设置。

### GNE-36 中：能力证据和启动流程依赖错误文案匹配

位置：`src/services/gateway/GatewayCapabilityRegistry.ts`、`src/services/gateway/Connection.ts` 与
`src/App.tsx`。

能力注册表把任意 `INVALID_REQUEST` 的“unknown method”文案判为方法不支持，并把普通字符串中的
“Request timeout”判为待核验。启动流程又通过文本搜索判断历史请求超时和启动期不可用。上述状态都缺少类型或
请求身份约束，错误文案变化会导致错误分类。

整改：本地请求超时使用专用 `GatewayRequestTimeoutError`。能力注册表只在错误精确指向当前请求方法时接受
OpenClaw 当前 `INVALID_REQUEST: unknown method: <method>` 形状；其他状态读取结构化错误码。启动流程按
`GatewayRpcError.code === "UNAVAILABLE"` 和超时错误类型判断后台同步，不再解析文案。

### GNE-37 高：未知方法证据在多个客户端复制非官方错误码

位置：`src/services/gateway/` 下的 Gateway 客户端、`src/stores/gatewayDataStore.ts`、
`src/services/openclawSkillsRuntime.ts` 与 `src/services/collaboration/client.ts`。

多个客户端把 `METHOD_NOT_FOUND`、`UNKNOWN_METHOD` 和 `UNKNOWN_COMMAND` 当作 Gateway 正式错误码，部分路径还接受
大小写宽松的“unknown method”或“no handler for”文本。最新版 OpenClaw Gateway 对未知方法返回
`INVALID_REQUEST`，消息精确为 `unknown method: <当前请求方法>`。分散实现无法证明错误属于当前请求，还会把其他
RPC、嵌套异常或测试夹具误判为能力缺失。

整改：提取 `GatewayProtocolEvidence` 作为单一协议证据解析边界。所有原生客户端、技能运行时、数据仓和协作插件
探测都必须把 `INVALID_REQUEST` 与当前实际方法的精确消息同时匹配；旧错误码、宽松文本、嵌套异常和错误方法全部
失败关闭。协作客户端只在该证据成立后生成本地 `METHOD_UNAVAILABLE` 领域状态，不再把旧传输码冒充上游事实。

### GNE-38 中：配置重载规划泄露原始异常并绑定本机版本样本

位置：`src/services/gateway/configReloadPlan.ts` 与其测试。

重载规划虽然会在未知语义时安全降级为重启，但 `fallbackReason` 拼接了查询异常的原始消息并进入调试日志；注释和
测试还以本机安装版本及固定路径样本描述能力。这会泄露未经审查的运行时异常，也容易把动态 Schema 误写成版本规则。

整改：重载规则只读取当前 Gateway `config.schema.lookup` 的路径级 `reloadKind`。失败原因收敛为
`lookup-failed` 或 `reload-kind-missing` 两个稳定本地分类，不携带原始异常；注释与测试不再绑定安装版本。

### GNE-39 高：聊天发送检查点按类名和英文消息判断 Gateway 失败

位置：`src/services/chat/sendTransaction.ts`、`src/stores/openclawTaskLedgerStore.ts`、
`src/stores/openclawApprovalsStore.ts` 与对应活动面板。

聊天发送失败后只识别 `GatewayDisconnectedError`、`GatewayRpcError` 的类名或固定英文断连消息；当前连接层在请求
尚未发出时实际抛出 `GatewayTransportLifecycleError`，导致已经创建的本地任务检查点可能保持未收敛状态。任务和
审批 Store 还会在调用方已经明确断连时写入英文错误，和面板统一离线态形成双重状态来源。

整改：发送协调器改用 Gateway 错误类型与稳定传输错误码识别确定失败，并在发送前连接失效时将已创建检查点收敛为
错误终态。任务和审批 Store 在断连时只清理陈旧操作错误，离线展示由共享连接状态负责；无上游诊断的本地失败使用
稳定领域错误码，翻译只在 UI 边界完成。

### GNE-40 高：usage 数据由页面重复建模并接受猜测字段

位置：`src/stores/gatewayDataStore.ts`、`src/pages/FullAnalytics/`、`src/pages/Dashboard/index.tsx` 与
`src/pages/AgentHub/AgentSettingsPanel.tsx`。

`usage.cost` 与 `sessions.usage` 曾由数据仓、分析页和仪表盘分别声明结构，部分消费者用 `any` 读取
`modelName`、`modelId`、`metadata.model`、`totals.model`、`displayName` 等未由当前官方 usage 类型声明的字段。
这既绕过 Gateway 响应校验，也会让 UI 把猜测值显示为上游事实。

整改：在 `OpenClawUsageClient` 集中声明并验证当前官方 cost、session、aggregate、cache、latency 与模型用量结构；
数据仓只提交解析成功的结果，分析页改为共享类型别名。仪表盘和智能体设置只读取官方 `agentId`、`model`、
`modelOverride`、`modelProvider`、`providerOverride`、`usage` 与聚合字段，删除页面重复类型、强制断言和猜测别名。

## 设计边界

- 事件解码使用判别联合和纯函数，不为每种 stream 引入抽象基类。
- 运行序号栅栏、聊天投影和协作提示仍由各自单一职责组件持有；解码器不访问 store、连接或 UI。
- 不保留旧顶层协作事件或猜测性兼容分支。
- 未连接真实最新版 Gateway 回放上述载荷前，不把单元测试描述为真实 Gateway 验证。

## 实施结果

已按对应规格与计划完成 GNE-11 和 GNE-12 的代码整改：

- `src/processing/openClawChatEvent.ts` 现在把 `agent`、`chat`、`session.tool` 解码为不可变判别联合；Agent 的 `ts`、`seq` 均要求非负安全整数，Chat 的封闭状态与每种状态的必填字段在进入运行投影前校验。
- `ChatHandler` 的传输边界只接收完整的 `{ type: "event", event, payload }` 信封。实时事件先解码，之后才调用运行序号栅栏；非实时事件经各自的解码器或失效刷新路径处理。
- 旧的 Chat 自定义 `stream` 分支以及顶层 media 字段读取已移除。媒体仅从官方 Chat message 的不透明消息载荷中读取，客户端不再根据未声明的顶层字段或本地协议分支推断媒体。
- 协作 bridge 只接受 `event: "agent"` 与 `stream: "junqi-collab.changed"`。顶层同名事件会回到普通 Gateway 路由；Runtime identity fixture 仅声明官方顶层 `agent` 事件。
- 协作设计文档中的刷新提示已改为完整 Agent event 信封，避免把 stream 误写为 Gateway 顶层事件。
- 已完成 GNE-13：删除无消费者 Tauri command、旧 PTY 模块、旧文件目录列举、调试日志写入和其专属测试；
  快速会话与动态岛的 Rust 内部函数保留，但不再被额外暴露给 WebView。
- 已完成 GNE-14：高风险 Tauri wrapper 改由真实 invoke 载荷测试守护，源码文本正则测试已删除；注册表守护
  只验证直接字面量调用关系。
- 已完成 GNE-15：钉钉 manifest 工具清单由编译后运行时规格逐项校验；删除无消费者的
  `junqi.collab.plan.get` 扩展 RPC 与文档条目。
- 已完成 GNE-16：非聊天 Gateway 事件公共入口从 `any` 收束为 `unknown`，只在通过对象记录守卫后
  读取会话失效字段；无法安全序列化的未知载荷不再使调试日志路径抛出异常。
- 已完成 GNE-17：删除失效的智能体资料源码文本守护，以实际 Tauri 调用载荷和 Rust 纯状态测试替代；停止 Gateway
  只守护按运行时统一分派的公开入口，不重新暴露 Docker 专用 command。
- 已完成 GNE-18 至 GNE-25：连接目标、权限事件、Gateway 状态、子智能体活动、设备凭据、协作维护状态和
  钉钉运行时边界均收敛到单一结构化契约。
- 已完成 GNE-26：协作包校验不再依赖编译后私有函数名，公开包契约与恢复行为测试分离。
- 已完成 GNE-27：协作任务、Attempt 和墓碑只接受插件当前完整驼峰结构，旧别名和缺字段默认值已删除。
- 已完成 GNE-28：维护租约所有者只由 Rust 安装级文件持有，WebView 不再向原生层迁移身份。
- 已完成 GNE-29：删除依赖私有源码形式的 Gateway 与协作守护，改由可执行状态、IPC 和公开产物契约覆盖。
- 已完成 GNE-30：维护租约只接受版本一的完整持久化结构，无版本状态失败关闭。
- 已完成 GNE-31：协作数据库只接受现行 schema 14，统一回执、受管制品路径和删除作业身份均收敛为单一权威。
- 已完成 GNE-32：session mutation impact 与 prepare 均使用显式 `runId` wire 身份；数据库内部 `id` 不再跨 RPC。
- 已完成 GNE-33：历史消息身份只读取 `__openclaw.id`，发送运行身份只读取顶层 `idempotencyKey`；
  未声明的顶层和元数据别名全部失败关闭。
- 已完成 GNE-34：删除客户端复制的模型可见性算法及专属测试；静态健康检查只保留可由配置本身证明的约束，
  模型目录和运行时可见性继续由 Gateway `models.list` 提供。
- 已完成 GNE-35：授权分类只依据结构化错误码，WebSocket 关闭原因和普通错误文案不再生成配对、凭据、权限或
  限流事实。
- 已完成 GNE-36：本地请求超时使用 `GatewayRequestTimeoutError`；未知方法证据必须精确绑定当前请求方法，
  启动期后台同步只依据结构化 `UNAVAILABLE` 或本地超时类型。
- 已完成 GNE-37：所有原生 Gateway 客户端、技能运行时、数据仓和协作插件探测共用
  `GatewayProtocolEvidence`；生产代码不再接受三个非官方未知方法错误码或宽松文本。
- 已完成 GNE-38：配置重载规划只保留稳定失败分类，不记录原始异常，也不以本机版本样本预置运行时规则。
- 已完成 GNE-39：聊天发送检查点按类型化 Gateway 失败收敛；任务与审批断连状态不再生成英文伪错误，
  本地兜底错误由活动面板统一翻译。
- 已完成 GNE-40：usage 数据由单一 Gateway 解析器校验，分析页、仪表盘和智能体设置不再使用 `any` 或
  未声明字段补全模型、Agent 与历史会话信息。

## 自动化验证

已实际执行并通过：

- `pnpm exec tsc --noEmit`；
- 实时事件、协作 bridge、协作 setup 的定向测试，共 79 项通过；
- `pnpm lint`，包括模块边界、版本一致性与 TypeScript 检查；
- `git diff --check`。
- `cargo fmt -- --check`、`cargo check --lib`；
- 两个受影响的 Rust 项目配置回归测试。
- Tauri wrapper 可执行契约测试 5 项；Tauri 直接字面量注册守护测试 1 项。
- 未知方法证据、配置重载、消息身份、授权、协作、技能、数据仓和会话生命周期定向测试 154 项通过；
- 聊天发送、原生任务账本和审批 Store 定向测试 25 项通过；
- usage 解析、数据仓与分析查询定向测试 33 项通过；
- 完整 `pnpm test` 的前端与仓库脚本测试均通过，零失败；
- 完整 `pnpm test:rust`：684 项通过、2 项忽略、零失败；
- `pnpm build`：协作插件、钉钉插件契约和打包均完成，TypeScript 与 Vite 生产构建通过并生成 `dist`。
- `pnpm verify:openclaw-docs`：OpenClaw 官方命令链接校验通过。
- `pnpm dingtalk:test`：18 项通过；`pnpm dingtalk:validate`：编译后工具清单与 manifest 校验通过。
- `pnpm collab:test`：364 项通过；`pnpm collab:validate`：协作插件注册、领域与包契约测试通过。
- `pnpm collab:bundle`：生成 167 个校验文件，schema 14，bundle SHA-256 为
  `0778a9538482e492b9acc8bb079dcec959e8546b07231de898f06138c1b9275f`，generated metadata 与 Tauri resource metadata 一致。
- `src/stores/gatewayDataStore.test.ts`：29 项通过，包含未知载荷与安全日志回归用例。
- 对本轮修改后的完整文件执行 Unicode 扩展象形字符扫描，未发现 Emoji。

新增回归覆盖畸形 Agent 和 Chat 事件不抢占有效同序号事件、未知但完整的 Agent stream 不生成聊天界面状态、以及不存在的协作顶层事件不通知协作监听器。

## 未验证边界

- 尚未在受控最新版真实 Gateway 上回放本次严格解码的 Agent、Chat 和 `session.tool` 事件。
- 2026-08-10 两次执行隔离 structural harness；当前 bundle 校验与 Docker preflight 均通过，但固定摘要的
  OpenClaw `2026.7.1` 镜像两次都在 600 秒拉取上限处失败。插件未安装、Gateway 未启动，不能形成兼容性结论；
  harness 确认没有遗留受控容器、网络或 volume。该版本也不能替代最新版上游验证。
- 尚未完成目标平台真机验证。
- Node 的 Tauri 内部桥只能验证 JavaScript 侧 wire 参数；真实 WebView 到 Rust handler 的端到端调用仍未验证。
