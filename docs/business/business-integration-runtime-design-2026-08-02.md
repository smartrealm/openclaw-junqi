# 业务集成运行时多态架构

日期：2026-08-02

## 目标

JunQi 的“业务集成”是一类可安装、可授权、可发现能力、可执行受控操作并可完整追溯的运行时。钉钉 DWS 是当前唯一已规划的实现，但不能因此把页面、状态、Tauri command、存储或审计模型命名为钉钉专用，也不能复制一套新平台逻辑。

目标是在单一集成框架中支持多个业务平台，例如钉钉、飞书、企业微信、Microsoft 365、HR/OA 或企业内部系统；每个平台只提供自身的安装、授权、能力发现、操作执行和深链适配器。

## 非目标

- 不将 OpenClaw 聊天 Channels 变成业务集成注册中心。消息渠道和业务 API 可共用同一平台，但认证主体、权限、生命周期和操作审计不同。
- 不把所有第三方 API 规范化为“审批”模型。审批、考勤、待办、文档等是由 capability catalog 描述的业务能力。
- 不要求未来平台实现 DWS 的 profile、CLI 或 raw API 语义。抽象只约束可观测行为与安全边界。
- 不在前端根据 `integrationId` 写条件分支，不保存任意平台的 secret、token 或原始敏感业务数据。

## 总体结构

```text
顶部一级 Tab：业务应用
  -> BusinessIntegrationRegistry
  -> IntegrationDetailSurface
  -> BusinessIntegrationCoordinator
  -> typed Tauri command
  -> BusinessIntegrationAdapter
  -> 平台运行时 / CLI / 官方 API / 企业服务

聊天、业务页、工作流
  -> BusinessOperationRequest
  -> CapabilityGate
  -> ConfirmationPolicy
  -> BusinessOperationCoordinator
  -> OperationJournal
  -> 统一追溯 UI
```

页面不调用平台 SDK、CLI 或 HTTP；React 只处理跨平台 DTO。Tauri 是桌面权限、参数数组执行、系统凭据边界、原生安装与受控深链的唯一入口。每个 Adapter 在 Rust 侧或受控企业服务侧实现，不能由页面加载任意脚本。

## 多态契约

### 集成描述

```ts
type BusinessIntegrationDescriptor = {
  id: string;
  display: IntegrationDisplay;
  kind: 'cli' | 'native-api' | 'managed-service' | 'hybrid';
  lifecycle: IntegrationLifecycleSnapshot;
  authentication: AuthenticationSnapshot;
  profiles: IntegrationProfileSummary[];
  capabilities: CapabilitySnapshot;
  tracePolicy: TracePolicy;
};
```

`id` 是稳定技术标识，展示名称、图标和文案来自 descriptor 或本地 i18n。DingTalk 的首个 `id` 可为 `dingtalk-workspace`，但任何通用 UI、store、command 或数据库表不得用 `dws`、`dingtalk` 作为前缀。

### 适配器端口

| 端口 | 责任 | 必须避免 |
| --- | --- | --- |
| `IntegrationDiscoveryPort` | 枚举当前可用集成和版本化 descriptor | 页面写死集成列表。 |
| `RuntimeProbePort` | 发现安装位置、版本、完整性、健康和诊断 | 以 PATH 命中或进程存在作为健康成功。 |
| `InstallationPort` | 生成可展示的安装计划、执行和验证安装结果 | `curl | sh`、隐藏替换、未经确认升级。 |
| `AuthorizationPort` | 开始、取消、观察和验证授权会话 | 伪造 QR、浏览器 URL 或授权成功。 |
| `ProfilePort` | 列出、精确选择、验证和失效 profile | 按显示名、最近项或数组第一项自动选择。 |
| `CapabilityPort` | 读取当前 profile 的能力、参数 schema、effect 和限制 | 静态复制平台命令、字段或 scope。 |
| `OperationPort` | 执行经过 gate 的结构化操作，返回已校验 DTO | shell 拼接、任意 host、任意命令路径或不受限输出。 |
| `DeepLinkPort` | 打开平台原始记录、应用或浏览器页面 | 由 UI 拼接未知 URL。 |
| `TracePort` | 写入和查询操作、确认与后续状态追溯 | 在 trace 写入 token、附件正文或隐私内容。 |

每个 Adapter 仅实现自己支持的端口。缺失端口以 capability 状态说明“不可用”，不能返回虚假的空成功对象。例如没有可视化安装路径的 SaaS 集成可实现授权和能力发现，但不实现 `InstallationPort`。

### 统一状态机

```text
not_available
  -> discoverable
  -> install_planned
  -> installing
  -> installed_unverified
  -> authorization_required
  -> authorizing
  -> profile_selection_required
  -> capability_discovery
  -> ready_read_only
  -> ready_for_verified_write

任意适配器失败、profile 失效、scope 收回或能力漂移
  -> blocked_with_recovery
```

状态是跨平台语义，不要求各平台内部存在同名状态。适配器将平台状态映射为该状态机，并提供原因、恢复动作和最后探测时间。`ready_for_verified_write` 必须由具体 capability gate 判定，不能因为已登录而全局放开写操作。

## 通用 UI

具体的多平台页面信息架构、视觉约束和钉钉、飞书、Google Workspace 的接入体验见[业务应用多平台 UI 设计](business-applications-ui-design-2026-08-02.md)。本节只保留运行时与通用组件的边界。

### 顶部入口与业务应用目录

“业务应用”是顶部一级 Tab，与仪表盘、智能体、工具、常用命令和设置同级。它应紧跟“智能体”，作为跨业务平台能力的稳定工作区入口；不能隐藏在设置深层或某个聊天会话内。推荐排序为：`仪表盘 | 智能体 | 业务应用 | 工具 | 常用命令 | 设置`。

“业务应用”是产品语言；`BusinessIntegrationRegistry` 是内部技术术语。该 Tab 展示 Registry 返回的卡片。卡片固定显示：平台名称与图标、运行时类型、版本/健康、授权状态、当前 profile 摘要、可用能力数量、最近操作结果和“查看详情”。它不显示密钥、token、完整账号或敏感操作正文。

当前目录只有一张“钉钉工作台”卡；UI 仍使用列表、空态和 descriptor 驱动布局，不为单卡另写专属页面结构。以后新增业务应用仅注册 Adapter 与 i18n/图标资源。聊天、智能体、工作流和业务页面只提供到此 Tab 的深链，不复制管理入口。

设置页只保留集成运行时的高级管理入口，例如安装源策略、网络/代理诊断、日志位置、企业管理员策略和危险恢复动作。它不能承担日常授权、profile 切换、业务能力使用或操作追溯。

### 通用详情页

详情页按一致的六个区块渲染：

1. 运行时：安装、版本、更新、健康和诊断。
2. 授权：开始/取消授权、授权结果和恢复入口。
3. 身份：profile 列表、精确选择与组织边界。
4. 能力：当前 capability catalog，按只读/写入/受限分类。
5. 操作：只显示当前集成声明、当前 profile 有权执行且页面场景需要的操作。
6. 追溯：跨页面一致的操作 Journal、业务实体关联和平台原始记录深链。

平台专属 UI 仅作为“业务模块内容插槽”，例如钉钉请假草稿、Microsoft 日历邀请或飞书文档权限设置；安装、授权、确认、错误、追溯和辅助技术详情一律复用通用组件。

## 操作模型与确认

```ts
type BusinessOperationRequest = {
  integrationId: string;
  profileRef: string;
  capabilityId: string;
  input: unknown;
  correlationId: string;
};
```

`input` 在 Rust adapter 边界转换为各平台的强类型 DTO；TypeScript 页面不得使用 `any` 或平台命令字符串传递任意对象。Coordinator 依次执行：

1. 验证 integration、profile、capability 和 runtime fingerprint。
2. 根据 `effect`、敏感字段、目标实体和业务策略生成可读 `OperationPlan`。
3. 读操作可直接运行；写、撤销、删除、审批决定、外发通知和涉及敏感附件的操作必须显示确认页。
4. 确认后由 Tauri adapter 运行，不将确认当作执行成功。
5. 校验回执、记录 Journal、触发权威实体重读；无法重读时显示“结果待确认”。

确认策略由 `ConfirmationPolicy` 统一实现。即使平台 CLI 没有内置确认，JunQi 的 UI 仍遵循本项目高影响操作确认规则。

## 可追溯模型

所有平台共享 `BusinessOperationJournal`：

| 字段 | 说明 |
| --- | --- |
| `operationId`、`correlationId` | 操作、重试、聊天、工作流和后续读取的关联键。 |
| `integrationId`、`runtimeFingerprint` | 平台、适配器版本、运行时版本和能力快照版本。 |
| `profileRef`、`tenantScope` | 经过脱敏展示的精确身份和租户边界。 |
| `capabilityId`、`effect`、`planRevision` | 调用意图和操作风险。 |
| `inputSummary`、`inputDigest` | 可读脱敏摘要与重试一致性验证。 |
| `confirmation` | 操作者、时间、确认摘要 hash、取消或拒绝原因。 |
| `result` | 退出类别、规范化错误、平台 request/instance 引用、耗时和响应摘要。 |
| `entityLinks` | 审批实例、待办、文档、日程等业务实体的稳定引用。 |
| `followUps` | 重读、事件回调、轮询或人工复核的状态与时间。 |

Journal 是“JunQi 做过什么”的审计，不是对第三方平台状态的替代。实体详情始终重新读取平台权威状态，并标明最后同步时间和失败原因。

## 钉钉 DWS 适配器

第一期注册 `DingTalkWorkspaceAdapter`：

| 通用端口 | DWS 实现 |
| --- | --- |
| `RuntimeProbePort` | 探测 `dws` 二进制、版本、帮助和诊断命令。 |
| `InstallationPort` | 展示官方可验证安装计划，执行已审核安装器并重新探测。 |
| `AuthorizationPort` | 启动并观察 `dws auth login`，通过 `dws auth status` 复核。 |
| `ProfilePort` | 使用 `dws profile list` 与精确 profile 选择器。 |
| `CapabilityPort` | 使用 `dws schema <product>` 和受限的真实产品探测。 |
| `OperationPort` | 使用参数数组调用 `dws oa`、`dws attendance`、`dws todo` 等；仅在自建应用 profile 已验证时开放 `dws api`。 |
| `TracePort` | 记录 DWS runtime/profile/capability、受限 JSON 回执和后续 OA 实例读取。 |

`dingtalk-connector` 是 OpenClaw Chat channel，不是此 Adapter 的父类或替代品。两者可以共享钉钉展示资源和来自同一用户的操作上下文，但不能共享 token、配置写入路径或授权成功判断。

## 代码边界

```text
src/business-integrations/domain/        通用状态、端口、operation plan、Journal 类型
src/business-integrations/adapters/      每个平台的前端 DTO 与显示适配器
src/business-integrations/services/      Registry、Coordinator、CapabilityGate、Trace 查询
src/components/BusinessIntegrations/     通用目录、详情、授权、确认、追溯 UI
src-tauri/src/business_integrations/      Rust ports、adapter 注册、参数校验和 Journal 存储
src-tauri/src/business_integrations/dingtalk_workspace/
                                        DWS 专用探测、执行与响应规范化
```

禁止在 `SettingsPage`、`ChatView`、`ChannelsCenter` 或单个业务组件内创建第二条安装、授权、profile、执行或审计逻辑。任何新平台都先实现通用端口和契约测试，再注册到 Registry。

## 验收条件

1. 集成目录、详情页、状态机、确认和追溯 UI 不依据 `integrationId` 编写平台分支。
2. 当前只有钉钉时，目录仍从 Registry 获取一项，不存在专用单卡页面或隐藏的默认 profile。
3. 不同集成可独立处于未安装、授权中、只读就绪、写入受阻或恢复状态，互不覆盖。
4. 安装、授权、profile 切换、capability 漂移、写操作确认、平台超时、回执解析失败和后续重读都有契约测试。
5. 任何页面都不能直接执行 CLI、读写平台 token 或发起原始 HTTP；所有操作通过 typed Tauri command 和 Journal。
6. 新增第二个集成只增加 Adapter、资源、测试和注册项，不修改通用协调器的 `if/else` 平台分支。

## 待验证事项

- 适合 JunQi 打包分发的 DWS 安装方式、签名/校验、升级和回滚策略。
- DWS 各版本对 JSON 授权会话、schema、catalog、诊断和 profile 命令的稳定输出契约。
- 跨 macOS、Windows、Linux 的 DWS 进程取消、Keychain/凭据库、设备流和浏览器授权行为。
- 第二个业务集成的选择和适配器实现，用于验证该抽象未被钉钉细节污染。
