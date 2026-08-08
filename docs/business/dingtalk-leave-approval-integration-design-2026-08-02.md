# 钉钉 OA 请假审批接入设计

日期：2026-08-02

> 历史设计：DWS 当前主线已提供正式 profile 命令和 `oa approval create-instance`。新的运行时归属、审批与分期以[钉钉业务工作台运行时实施设计](dingtalk-business-runtime-implementation-design-2026-08-08.md)为准，本文不得作为当前命令或实现契约。

## 目标与范围

为大夏集团的 JunQi Desktop 接入钉钉 OA 请假审批，支持员工在 JunQi 中形成请假草稿、核对信息、显式确认发起，并在 JunQi 中查看与钉钉一致的审批进度和审计记录。

本设计只定义接入边界和实施路径，不代表接口已经实现或某个钉钉租户已授权。请假模板、审批人、额度、字段名称、流程编号和组织规则均由大夏集团钉钉租户在运行时提供或由管理员配置，绝不写入 JunQi 代码。

## 已核对事实

| 事实 | 证据 | 结论 |
| --- | --- | --- |
| JunQi 的钉钉能力是 `dingtalk-connector` OpenClaw 外部聊天插件 | `src-tauri/src/commands/openclaw_channel.rs`、`src/services/channelConfig.ts` | 该插件负责聊天渠道安装、连接和路由，不是 OA 审批 API 适配器。 |
| 渠道页面以 OpenClaw Runtime catalog/status 为权威源 | `specs/quality/2026-07-26-openclaw-channel-runtime-authority-bugfix.md` | OA 集成不能把静态钉钉字段、模板或流程规则塞回 Channels 页面。 |
| JunQi 的跨端能力走 Tauri typed command 和服务边界 | `docs/quality/openclaw-gateway-ipc-boundary-convergence-2026-08-02.md` | 前端不能直连钉钉、持有 AppSecret 或解析租户凭据。 |
| `dws` CLI 提供审批表单、实例、待办、同意、拒绝、撤销、转交、评论和抄送查询命令 | [DWS 官方命令注册表](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/internal/cli/schema_command_registry/products/oa.json) | 大夏的 JunQi 可将 DWS 作为受控本地执行器；当前工作机未安装 CLI，因此未对真实租户执行命令。 |
| `dws oa` 的公开命令不含“发起审批实例” | [DWS OA 工具目录](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/internal/cli/schema_catalog/tools/oa.json) | 请假发起需要使用 `dws api` 调用经核验的钉钉 OpenAPI，不能伪造一个 `dws oa approval create` 命令。 |
| `dws api` 支持受可信钉钉域名白名单约束的原始 OpenAPI 调用 | [DWS api command](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/internal/app/api_command.go) | 原始 API 仅在自建应用凭据登录后可用；MCP 默认凭据不能用于该路径。 |
| 钉钉开放平台提供审批实例发起、详情和审批工作流能力 | [发起审批实例](https://open.dingtalk.com/document/development/oa-approval-initiates-approval-instances)、[审批工作流教程](https://open.dingtalk.com/tutorial/) | 正式实现必须以目标租户、目标应用类型和当期官方 API 文档校验后的契约为准。 |

## 产品边界

### 应做

1. 将自然语言或表单输入解析为请假草稿。
2. 在发起前显示可编辑的结构化预览，包括请假类型、开始与结束时间、时长、原因、附件和所选模板。
3. 仅在用户显式确认后，向企业侧钉钉 OA 集成服务提交一次请求。
4. 回写钉钉实例标识及状态投影，支持查看进度、打开钉钉原始审批和读取审计时间线。
5. 在权限已确认时展示待我审批项；批准、拒绝和撤销必须再次显式确认并写入审计记录。

### 不做

- 不把 OpenClaw 聊天机器人配置等同于钉钉 OA 授权。
- 不在 React、Tauri 前端持久化、日志、Markdown、测试快照或 OpenClaw 配置中存储钉钉密钥。
- 不把 AI 的解析结果、规则建议或风险评分作为发起、通过、拒绝或撤销审批的自动指令。
- 不硬编码 `processCode`、表单控件名称、请假类型、审批节点、员工 ID、部门 ID、租户 ID 或任何真实审批实例。
- 不承诺绕过钉钉内置审批、考勤、额度或管理员策略。

## 推荐架构

```text
JunQi Chat / 请假业务页
  -> LeaveDraftDomain
  -> DwsLeaveService (前端窄接口)
  -> Tauri typed command
  -> DWS CLI
  -> dws oa approval / dws attendance / dws api
  -> 钉钉审批实例 / 待办 / 考勤数据

可选增强：企业侧 OA Integration Service
  -> 钉钉事件回调、跨设备同步、集中审计
  -> JunQi 只读状态投影
```

### DWS 执行器

JunQi 不在 React 层拼接 shell 命令，也不读取、导出或持久化 DWS token。`DwsLeaveService` 只构造经过 DTO 校验的意图，Tauri command 以参数数组调用已探测到的 `dws` 可执行文件，强制 `--format json`、超时、退出码分类和结构化输出上限。DWS 负责其登录态和 token 刷新；JunQi 的审计记录仅保存命令类别、实例引用、结果类别与时间，不保存 DWS 凭据或原始理由。

`dws oa approval` 已能覆盖可见流程、已发起/待办/已处理/抄送实例、实例详情与记录、同意、拒绝、撤销、转交及审批评论。命令注册表当前没有“发起审批实例”命令，因此请假发起必须是独立能力：在自建应用凭据登录的 DWS profile 中，以 `dws api` 调用目标租户已核验的钉钉审批发起 API。MCP 默认凭据不得用于该原始 API 路径。

### 可选的企业侧 OA Integration Service

企业侧服务不是第一期阻塞项，但在以下场景应启用：需要保存经钉钉验签的异步回调、统一多台 JunQi 的状态投影、集中密钥轮换、跨设备审计或数据保留治理。启用后，DWS 仍可作为个人审批和运维工具；JunQi 不得在两条路径间静默切换写入目标。

### 与 OpenClaw 钉钉渠道的关系

`dingtalk-connector` 继续承担大夏集团的消息入口与 Agent 路由。它只能为“用户从钉钉消息提出请假”提供会话来源和通知通道。DWS profile 必须独立验证当前用户与钉钉员工身份的绑定，不能仅凭 channel 名、展示名称或聊天 sender 字段就代入请假申请人。

## 领域模型

| 实体 | 必需标识 | 说明 |
| --- | --- | --- |
| `LeaveTemplateBinding` | `tenantScope`、`bindingId`、`processCode` | 管理员选择的钉钉请假模板及其语义字段映射。`processCode` 是配置数据，不是代码常量。 |
| `LeaveDraft` | `draftId`、`actorId`、`templateBindingRevision` | 用户尚未确认的可编辑草稿，不等同于钉钉实例。 |
| `LeaveSubmission` | `submissionId`、`idempotencyKey`、`actorId` | 用户确认后创建的提交请求，防止双击、重连和重试重复发起。 |
| `DingTalkApprovalLink` | `tenantScope`、`instanceId`、`processCode` | JunQi 提交记录与钉钉审批实例之间的最小关联。 |
| `ApprovalProjection` | `instanceId`、`observedAt`、`sourceRevision` | 钉钉状态的只读投影；无法确认时显示未知，不能以旧状态代替当前状态。 |
| `ApprovalAuditEvent` | `eventId`、`submissionId`、`actorId`、`occurredAt` | 记录草稿确认、提交、状态同步、人工决定和失败，不保存不必要的敏感正文。 |

### 模板字段映射

管理员在企业服务的受控后台完成模板选择和字段映射。JunQi 获得的是经验证的“可填写字段 schema”，不是任意钉钉字段的写权限。最小语义集合为：

| 语义字段 | 要求 |
| --- | --- |
| 请假类型 | 必须由当前模板允许的选项动态返回。 |
| 开始时间、结束时间 | 使用模板指定的时区和时间精度；服务端验证结束晚于开始。 |
| 时长 | 由钉钉或企业规则计算并回显，不能由模型猜测后直接提交。 |
| 请假原因 | 用户可编辑，按企业最小保留策略存储。 |
| 附件 | 仅在模板和钉钉文件权限均已验证时启用；先上传到受控存储，再引用可验证文件标识。 |

模板变更、映射失效、字段缺失或账号无权访问时，草稿和提交操作失败关闭，并提示管理员重新验证绑定。不得回退到相似名称的模板或旧字段映射。

## 用户流程

### 发起请假

1. 用户在 Chat 或业务页输入请假意图，或打开“请假审批”入口。
2. `LeaveDraftDomain` 仅解析为草稿；缺失信息以表单补齐，日期歧义必须询问，不允许按模型猜测。
3. DWS 读取当前用户可见流程与相关考勤/假期事实；JunQi 将结果投影为模板绑定、字段 schema 与只读规则校验结果。
4. JunQi 展示“确认发起”页面。页面必须列出申请人、模板、时间、时长、原因、附件和将提交到钉钉的组织范围。
5. 用户点击确认后生成 `idempotencyKey`。Tauri 在本地 durable operation journal 中将该 key、申请人、模板绑定版本与 DWS 请求关联，防止重复进程执行。
6. `dws api` 返回的实例身份经 schema 校验后写入 `DingTalkApprovalLink`，UI 显示“已提交至钉钉，等待同步”，而不是虚构已批准。
7. DWS 重新读取实例详情、记录和待办以更新 `ApprovalProjection`；若已部署企业服务，可由经验证回调加速同步。用户可打开钉钉原始实例进行权威查看和处理。

### 审核与撤销

1. JunQi 仅展示企业服务确认当前用户有处理权限的待办。
2. “同意”“拒绝”“撤销”均先展示实例、动作、备注、影响和最终确认。
3. Tauri 通过 `dws oa approval approve|reject|revoke` 调用经当前 DWS schema 与租户授权验证的审批动作；成功只表示钉钉已确认回执。
4. 任何动作完成后重新读取实例详情或等待可信事件，不以按钮成功状态替代最终审批状态。

第一期建议只做“发起、详情、状态同步、打开钉钉”。审批人处理和撤销在权限、审计、事件订阅和幂等验证完成后单独开启。

## 可视化集成体验

### 入口与信息架构

在顶部一级 Tab“业务应用”使用通用业务应用页面，钉钉 DWS 作为第一个应用卡片和详情适配器，不复用 Channels Center。该入口紧跟“智能体”。Channels Center 继续只管理 OpenClaw 消息渠道；DWS 是跨 OA、考勤、待办、通讯录、文档和事件的业务执行运行时。设置页只保留安装源、诊断和高级策略入口；日常授权、能力使用与追溯都从顶栏业务应用页进入。通用状态机、安装、授权、profile、能力发现、确认和追溯模型见[业务集成运行时多态架构](business-integration-runtime-design-2026-08-02.md)。

页面固定由五个区域组成：

| 区域 | 用户看到的内容 | 权威事实与操作 |
| --- | --- | --- |
| 运行时 | 已安装、安装中、版本不兼容、不可用或待修复；来源、版本、安装位置和上次探测时间 | `DwsRuntimeProbe` 读取已安装二进制与版本。安装必须先呈现来源、版本、校验信息、目标位置和变更范围。 |
| 授权 | 未授权、等待授权、已授权、过期、需要管理员开启 CLI 或权限不足 | `dws auth status` 和授权会话的结构化结果；不能以进程已启动推断授权成功。 |
| 身份与组织 | 当前 profile、组织、用户、可切换 profile 和精确身份选择 | `dws profile list` 的稳定 profile 选择器。用户必须显式选择 `corpId:userId`，不能按显示名、最近账号或第一个数组项猜测。 |
| 能力目录 | OA、考勤、待办、通讯录、DING、聊天等能力是否可读、可写或受限 | `dws schema <product>` 与运行时 capability probe。界面只展示当前版本实际返回的工具，不维护另一份静态能力表。 |
| 操作记录 | 已执行、等待确认、已取消、失败、已完成的操作和审批关联 | `DwsOperationJournal` 与审批只读投影；每行可下钻输入摘要、确认、CLI 版本、profile、回执和后续状态读取。 |

### 安装向导

“安装钉钉工作台”不是一个直接执行 shell 的按钮，而是以下可恢复步骤：

1. 探测：调用受限 `DwsRuntimeProbe`，返回可执行文件位置、版本、平台、完整性、是否能运行 `dws --help` 和当前安装是否可升级。
2. 计划：展示官方来源、目标版本、包校验、安装路径、所需运行环境、是否会替换旧版本及可恢复策略。不能执行 `curl | sh`，也不把安装命令拼入 UI。
3. 确认：用户确认计划后，Tauri 的 `DwsRuntimeInstaller` 以参数数组运行已审核的安装器；stdout/stderr 仅作为进度和诊断，不作为成功事实。
4. 验证：安装结束后重新运行 probe 与 `dws --help`；只有版本、二进制完整性和命令发现均成功才标记“已安装”。
5. 修复：版本不兼容、安装中断或 checksum/探测失败时显示“重新检查”“查看诊断”“卸载本次未完成安装”，不静默回退到系统上另一个同名二进制。

官方 DWS 提供 npm、Homebrew、预编译发布物和源码构建等安装路径，也提供升级与回滚能力。JunQi 首期应选择一条可校验、跨平台且可追溯的路径，并把选择记录为 runtime metadata；不把某个开发机的 PATH、npm 镜像或 Homebrew 安装状态当作所有用户的默认条件。

### 授权与多组织选择

点击“授权钉钉”后，Tauri 发起目标 DWS 版本定义的 `auth login` 流程；桌面 UI 展示授权状态、官方浏览器/设备流交接信息和取消入口。JunQi 不伪造 QR、授权 URL 或成功提示。授权完成后必须以 `dws auth status --format json` 重新验证。

授权成功不等于当前业务可用。用户随后进入 profile 选择器：

1. 加载 `dws profile list --format json`。
2. 显示组织和用户身份，但自动化调用只保存返回的稳定 profile 标识。
3. 用户选择一个精确 profile；多账号同组织时不自动选择。
4. 对需要 `dws api` 的请假发起能力，单独显示“自建应用 profile 已验证”门禁。MCP 默认凭据只能使用已发现的 MCP/CLI 能力，不能越权执行 raw API。
5. 登录过期、管理员未开启 CLI 访问或 scope 不足时，显示 DWS 返回的可操作错误和官方恢复入口，不删除其他 profile 或覆盖当前配置。

### 能力目录与审批工作台

能力目录将 OA 显示为一个产品卡，不把它伪装成单一的“请假”按钮。卡片包含当前 profile 下实际发现的读写能力、所需确认级别、最后探测时间和失败原因。请假工作台仅在以下条件满足时解锁对应操作：

| 操作 | 最小门禁 | 可视化行为 |
| --- | --- | --- |
| 查看模板、我的申请、待办、详情和记录 | DWS 已安装、profile 已验证、OA 只读工具存在 | 显示列表、筛选、详情与“在钉钉中打开”。 |
| 创建请假草稿 | 只读模板工具与字段绑定已验证 | 显示可编辑草稿，不触发外部写入。 |
| 确认发起 | 目标 profile 的 `dws api` 写入门禁、管理员模板绑定和官方 API 契约测试通过 | 展示结构化摘要与最终确认；确认后生成幂等键。 |
| 同意、拒绝、撤销、转交 | 当前 profile 的对应 OA 写工具存在，目标实例/任务已重新读取 | 展示影响、备注、实例和任务身份，二次确认后执行。 |

### 统一执行与追溯

所有 DWS 操作进入同一个 `DwsOperationCoordinator`，而不是由不同页面各自启动终端：

```text
页面请求
  -> CapabilityGate
  -> OperationPlan
  -> 用户确认（写操作）
  -> Tauri DwsCommandRunner
  -> JSON 输出校验 / 错误分类
  -> DwsOperationJournal
  -> 业务投影刷新 / 审批追溯
```

`OperationPlan` 必须是结构化数据，不存放一条可复制 shell 字符串。它包含 tool path、参数 DTO、effect、profile、超时、是否要求确认和预期响应 schema。`DwsCommandRunner` 只能执行通过 capability gate 的工具路径与参数数组，拒绝重定向、管道、环境变量注入、任意 host、未声明的 profile 和超出长度的输出。

每个 `DwsOperationJournal` 条目最小包含：

| 字段 | 用途 |
| --- | --- |
| `operationId`、`correlationId` | 将 UI 操作、重试、后续状态读取和聊天引用关联起来。 |
| `runtimeFingerprint` | DWS 路径、版本、安装来源和 capability snapshot 版本。 |
| `profileRef`、`tenantScope` | 使用稳定标识的操作身份与租户隔离边界；显示层可脱敏。 |
| `toolPath`、`effect`、`planRevision` | 证明调用的是哪一项已发现能力及其读写属性。 |
| `inputSummary`、`inputDigest` | 展示脱敏摘要并检测重试是否改变参数；不保存 token、医疗说明和附件正文。 |
| `confirmation` | 用户、时间、确认界面摘要 hash 和取消原因。 |
| `executionResult` | 退出类别、受限 stderr 摘要、结构化响应摘要、耗时和 DWS request/correlation 标识。 |
| `approvalLink` | 仅在获得钉钉实例标识后保存的实例引用、最新状态、同步时间和详情读取记录。 |

聊天中的“执行追溯”与设置页“操作记录”读取同一 Journal。审批实例的详情页使用 operation correlation 反查草稿、确认、DWS 结果、实例详情和审批记录；原始钉钉数据始终以重新读取结果为准。

### 状态机与失败关闭

```text
not_installed
  -> install_planned
  -> installing
  -> installed_unverified
  -> ready_for_authorization
  -> authorizing
  -> profile_selection_required
  -> capability_discovery
  -> ready_read_only
  -> ready_for_verified_write

任一探测、授权、profile、scope、schema 或实例身份失败
  -> blocked_with_recovery
```

`ready_for_verified_write` 不是单纯的登录状态。它要求 DWS 版本、精确 profile、对应工具、目标租户模板绑定、官方 API 契约与最近 capability probe 全部仍然有效。任意一项变更后回退到只读或受阻状态，绝不使用旧缓存继续写入。

## 权限、身份与安全

| 边界 | 设计要求 |
| --- | --- |
| 租户隔离 | 每次读取、草稿、提交、查询和回调都绑定不可伪造的 `tenantScope`；跨租户实例 ID 一律拒绝。 |
| 用户身份 | JunQi 登录身份必须通过企业 SSO 或钉钉官方身份授权与员工主体绑定；聊天来源不是身份认证。 |
| 应用凭据 | DWS profile/系统凭据库或企业侧密钥库保存；JunQi 不显示、读取、导出或复制。`dws api` 仅允许已使用自建应用凭据登录的 profile。 |
| 权限最小化 | 分离模板读取、实例发起、实例读取、待办读取、审批动作和附件权限；缺少其中一项时只关闭对应功能。 |
| 写入确认 | 所有写操作均需用户最终确认和服务端幂等键；AI 没有自动批准权限。 |
| 回调可信性 | 只接受经官方签名验证、时间窗口和租户绑定校验的回调；重复事件按事件 ID 去重。 |
| 敏感数据 | 请假原因、医疗证明和附件仅用于审批所需范围；日志记录事件类型、实例引用和脱敏错误码，不记录正文或凭据。 |

## 钉钉 CLI 的定位

`dws` 是大夏的执行器，但 JunQi 不嵌入二进制、不读取其本地 token。管理员、Agent 和验收人员均经同一个受控 Tauri 执行端口调用它；命令的可用性必须由运行时 `dws --help`、`dws catalog` 或当前 schema 探测确认。以下为当前官方命令注册表中的只读核验操作：

```bash
dws oa approval list-forms --format json
dws oa approval initiated --format json
dws oa approval detail --instance-id <runtime-instance-id> --format json
dws oa approval records --instance-id <runtime-instance-id> --format json
dws oa approval pending --format json
```

需要改变审批状态时，CLI 的同意、拒绝、撤销和转交操作属于高影响动作。即使 DWS 当前 metadata 的 command-level confirmation 不是必选，JunQi 仍必须在目标实例、任务 ID、当前操作者、备注与影响范围均已展示后要求二次确认。自动化验收不可对真实生产审批做 destructive 操作；应使用专用测试租户和测试模板。

### 通过 DWS 发起请假的前置条件

```text
1. dws auth status 确认目标 profile 和租户
2. dws oa approval list-forms --format json 发现当前用户可见模板
3. 管理员确认模板绑定与字段映射
4. 自建应用凭据登录的 profile 通过 dws api 的只读 dry-run 和目标 API 契约验证
5. JunQi 允许“确认发起”写操作
```

第 4 步前，JunQi 只能提供草稿、只读实例与“在钉钉中继续”，不得发送未经核验的原始 API 请求。精确 API 路径、请求体、权限、幂等字段和错误码以目标应用类型下的官方审批文档为准，并在首次接入时固化为版本化契约测试。

## 实施分期

| 阶段 | 交付 | 前置条件 | 完成证据 |
| --- | --- | --- | --- |
| 0. DWS 发现 | `dws auth status`、运行时 schema、模板清单、管理员选定模板、字段映射和权限矩阵 | 大夏集团钉钉管理员授权测试 profile | 已脱敏的 DWS capability probe；不提交真实模板数据。 |
| 1. 只读 | `dws oa` 的当前用户已发起审批、实例详情、待办、钉钉跳转与状态投影 | 身份绑定和实例读取授权 | 租户隔离、未知状态、权限拒绝和断网回归测试。 |
| 2. 草稿 | Chat/表单草稿、字段校验、确认页面、审计草稿事件 | 模板 schema 与映射版本化 | 解析歧义、字段变更和取消确认均不产生钉钉实例。 |
| 3. 发起 | `dws api` 幂等提交、实例关联、DWS 重新读取与失败恢复 | 自建应用 profile、官方 API 写入契约、字段映射版本 | 重复点击、重连、超时、跨租户、profile 失效和重复实例测试。 |
| 4. 审核 | `dws oa` 待办、同意、拒绝、撤销与完整审计 | 审批动作最小权限和人工确认 UI | 逐动作授权、二次确认、审计不可抵赖和真机租户验收。 |
| 5. 企业同步 | 经签名回调、跨设备状态投影和集中审计 | 企业侧 OA Integration Service | 回调重放、验签失败、延迟同步和服务不可用测试。 |

## JunQi 文件边界

后续实施以单一职责划分，不能把钉钉 SDK、表单解析、密钥、UI 和审计混入同一组件：

```text
src/business/leave/domain/              纯领域模型、草稿和状态机
src/business/leave/services/            前端窄服务与 DTO 校验，不访问 DWS 凭据
src/components/Business/Leave/          草稿、确认、详情和待办 UI
src-tauri/src/commands/leave_approval.rs 仅 typed command 与 DWS 参数数组调用
src-tauri/src/leave_approval/           DWS 探测、身份、租户、幂等、错误分类和审计端口
docs/business/                          业务契约与验收记录
specs/business/                         行为规格
plans/business/                         分阶段执行计划
```

页面不可绕过 typed command 直接执行 DWS 或调用钉钉 API。若企业服务通过 HTTPS 暴露，Tauri command 仍需强制 selected tenant、设备身份和最小 DTO；若企业服务由 OpenClaw 插件实现，也必须保持独立的 OA 契约和审批审计边界，不能复用聊天 channel 配置或消息 token。

## 验收清单

1. 运行时从管理员配置读取模板绑定，不存在固定请假 `processCode` 或字段名称。
2. 未建立经验证身份绑定的用户不能创建或查看他人请假实例。
3. 模板映射不匹配、租户切换、权限失效、回调验签失败和状态未知均失败关闭。
4. 点击取消、关闭确认页、网络超时和重复提交不会生成重复钉钉实例。
5. 所有写操作都有明确的用户确认、幂等键、钉钉回执和审计事件。
6. 聊天渠道离线不影响已提交实例的只读查看；OA 服务不可用时聊天能力也不应被错误标记为不可用。
7. 只读、草稿、发起、审批动作、回调同步、跨租户隔离和敏感日志均有单元/契约测试。
8. 在大夏集团测试租户中通过真实管理员、申请人和审批人三种身份完成验收；生产租户仅在变更审批后启用。

## 待验证事项

- 大夏集团实际部署的 DWS 版本、`dws catalog` 输出、profile 选择与 `dws auth status` 的租户身份投影。
- 大夏集团当前钉钉组织是企业内部应用、服务商应用还是连接器接入，及其可授予的审批 scope。
- 实际请假模板的可见范围、`processCode`、字段 schema、时区、时长计算、附件策略和审批节点。
- 当期钉钉开放平台中发起、查询、事件订阅和审批动作接口的精确请求/响应字段、限流、签名和回调契约。
- 企业侧 OA Integration Service 的部署位置、数据保留期限、密钥库、灾备、日志脱敏和审计负责人。
- 是否在第一期开放审批人动作；默认建议不开启，保留钉钉客户端为权威处理界面。

在这些事项获得管理员与官方文档的可复现证据前，不得实现真实写入或用演示数据宣称请假审批已接入。
