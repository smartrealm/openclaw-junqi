# 业务应用多平台 UI 设计

日期：2026-08-02

## 目标

“业务应用”是 JunQi Desktop 面向企业协作系统的统一工作区。它负责让用户发现、连接、授权、使用和追溯业务平台能力；钉钉工作台、飞书和 Google Workspace 是其中的独立适配器，而不是三套平行产品。

本设计以桌面应用的持续操作为中心：用户能同时看到选定租户、身份、能力范围、待确认操作和操作记录，不需要在设置、聊天和外部网页之间猜测当前状态。

本文中的 Google Workspace 是对“G”的暂定解释。若后续确认目标是 GitHub，只需新增 GitHub Adapter 和能力描述，不修改目录、授权、确认或追溯 UI 的通用结构。

## 权威依据

| 平台 | 已核对依据 | 对 UI 的约束 |
| --- | --- | --- |
| 钉钉工作台 | [DWS 官方仓库](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli)、[DWS OA 命令注册表](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/internal/cli/schema_command_registry/products/oa.json) | 安装、登录、profile 和能力目录必须由实际 DWS 运行时探测，不能在页面静态宣称可用。 |
| 飞书 | [获取授权码](https://open.feishu.cn/document/common-capabilities/sso/api/obtain-oauth-code)、[获取 user_access_token](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token?lang=zh-CN)、[原生审批任务](https://open.feishu.cn/document/server-docs/approval-v4/task/introduction) | 用户授权与应用身份权限必须分别展示；审批任务状态来自平台重读，不能由本地操作记录推断。 |
| Google Workspace | [桌面应用 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、[Google Workspace 开发指南](https://developers.google.com/workspace/guides/get-started)、[产品目录](https://developers.google.com/workspace/products) | 必须使用系统浏览器授权、PKCE、精确 redirect 校验和最小 scope；启用的 API 与已授权 scope 要分别展示。 |

飞书审批实例创建使用应用身份，官方文档要求 `tenant_access_token`；飞书用户操作则可以使用 `user_access_token`。Google 桌面应用不能保守客户端 secret，授权范围由用户同意的 scope 决定。钉钉 DWS 的 profile、命令和 JSON 输出随运行时版本变化，均须在本机探测后再显示。

## 信息架构

顶级导航固定为：`仪表盘 | 智能体 | 业务应用 | 工具 | 常用命令 | 设置`。

“业务应用”紧跟“智能体”，因为它是 Agent 可使用的企业业务能力来源，但它不是 Agent 设置的子页面，也不是普通工具清单。聊天、工作流、任务简报只能深链至某一业务操作或追溯记录，不能复制第二份连接管理页面。

页面使用稳定的桌面三栏布局：

```text
应用目录                 当前应用工作区                       操作记录
已连接 / 可连接          概览 | 能力 | 操作                  当前上下文
平台、组织、状态         身份、授权、可用能力、待办          计划、确认、结果
添加应用                 平台专属业务模块插槽                权威记录深链
```

窄窗口下右侧“操作记录”收进可开关侧栏；左侧目录保持可见。不得用悬浮大弹窗承载日常操作，也不得让右侧记录挤压主表格为不可读宽度。

## 页面骨架

### 顶部应用栏

页面标题为“业务应用”。标题右侧只放三项跨平台动作：刷新探测、查看全局记录、添加应用。图标按钮必须有多语言 tooltip，且按钮文本仅在窗口宽度充足时显示。

刷新只重新探测当前 Adapter 的运行时、授权和 capability 快照；它不重新执行已确认的业务写操作。刷新期间保留上一份已验证快照，显示“正在检查”和快照时间，避免整页闪烁或清空。

### 左侧应用目录

左侧不是营销卡片墙，而是可扫描的应用导航树，分为“已连接”和“可连接”。每行由 descriptor 驱动，固定展示：

| 区域 | 内容 |
| --- | --- |
| 识别 | 平台图标、显示名称、运行时类型。 |
| 状态 | 已连接、需要授权、需要管理员配置、不可用或检查失败。 |
| 边界 | 当前组织或 profile 的脱敏摘要；没有已验证身份时显示“未选择身份”。 |
| 信号 | 未处理待办或最近失败数量，仅在运行时提供且用户有权查看时显示。 |

初始目录可注册“钉钉工作台”“飞书”“Google Workspace”三个可连接项。它们出现不代表已经具备所有功能：若未检测到运行时、未完成开发者配置或无权授权，只显示准确的前置条件和“查看要求”，不显示虚假的“连接成功”。

“添加应用”打开右侧抽屉而非跳转设置页。抽屉按支持状态呈现候选适配器，显示接入方式、所需管理员动作、可申请的能力类别和官方说明入口。按钮使用“开始连接”“完成管理员配置后重试”或“查看运行时要求”等由状态决定的命令，避免统一的“安装”文案误导 SaaS 平台。

### 中间应用工作区

选中应用后，标题区域按以下顺序呈现：图标和名称、连接状态、当前组织或 profile、最后验证时间、平台原始设置入口。标题下方采用三级固定标签：

1. 概览：连接健康、身份、授权摘要、最近业务状态和恢复动作。
2. 能力：按业务结果组织的 capability catalog。
3. 操作：当前身份已获准、且当前业务场景可执行的操作与草稿。

“追溯”不作为平台专属第四页；它由右侧统一记录栏承载，也可从顶部“查看全局记录”进入跨平台查询页。这样用户不必在每个平台中学习不同的日志入口。

概览中的状态行固定采用同一顺序：运行时或应用配置、授权、身份、权限范围、能力快照。每一行只能有一个主要恢复动作。错误信息写明可恢复原因和下一步，例如“飞书应用身份缺少审批实例创建权限”“Google Calendar API 尚未在该 Cloud 项目启用”“DWS profile 已失效”。不得把底层 token、命令参数或完整账号写到 UI 或日志。

### 右侧操作记录

右栏是 `BusinessOperationJournal` 的视图，而不是组件各自私有的 toast 历史。记录按相关性聚合为操作组：计划、确认、提交、平台回执、权威重读、人工处理和最终状态。

每条记录只展示脱敏摘要、执行人、时间、结果、关联实体和下一动作。用户可展开查看结构化字段差异和规范化错误码；可通过受控 `DeepLinkPort` 打开钉钉审批、飞书审批实例或 Google Calendar/Drive 原始记录。不存在原始链接时，明确标注“平台未提供可验证跳转”。

## 人操作与 AI 操作的双入口

业务应用页和 Chat 是同一个业务协调器的两个入口，不是两条相互独立的执行管线。

1. 人操作：用户在业务应用中选择平台、身份和 capability，编辑业务草稿，审阅 `OperationPlan` 并明确确认。业务页始终显示权限、影响范围、确认状态和 Journal。
2. AI 操作：Chat 中的 Agent 只能读取脱敏的 capability snapshot，提出结构化操作计划或请求用户确认。用户也可以从能力目录使用“交给 AI 规划”，将平台和能力上下文作为可见草稿带入当前会话。

两条入口都必须使用同一个 `BusinessOperationCoordinator`、`CapabilityGate`、`ConfirmationPolicy` 和 `BusinessOperationJournal`。AI 不获得独立 token、CLI 或 HTTP 通道；没有用户确认和 capability gate 的操作不得执行。Chat 与业务应用之间传递的是平台标识、能力标识、权限摘要和用户可见输入摘要，不能传递 secret、完整 profile、租户敏感标识或原始业务正文。

## 平台接入体验

### 钉钉工作台

钉钉使用 DWS CLI Adapter。连接流程是“检查 DWS 运行时 -> 展示经过审核的安装计划 -> DWS 登录 -> 精确选择 profile -> 读取 capability catalog -> 验证能力”。DWS 不是 OpenClaw 钉钉消息渠道的替代品，页面不能复用 Channel 凭据或以聊天已连接判定 OA 已授权。

概览优先显示 profile、组织边界和 DWS capability snapshot。能力页按实际 `dws schema` 结果组织为“审批与待办”“考勤”“日历”“文档与知识”“消息与协作”等类别；未发现或未授权的命令保持不可用并给出真实原因。请假等业务模块仅在管理员完成模板绑定、字段映射和写入授权验证后出现。

### 飞书

飞书 Adapter 的连接向导分为“应用配置”和“用户授权”两段。前者校验 JunQi 受控的应用配置和管理员授予的应用权限，后者使用系统浏览器发起授权码流程，验证 `state` 与回调地址，再以受控后端交换和存储 token。用户身份与租户应用身份必须分别标识，不能因为用户已登录就开放审批实例创建。

能力页可展示经探测和授权确认的“日历”“云文档与云空间”“任务”“审批”等业务类别。审批操作需要展示审批定义、目标申请人、表单摘要和最终影响；创建、同意、拒绝、转交和退回都走统一确认与 Journal。飞书返回的权限缺失应在对应能力条目上显示“补充授权”，而不是让用户面对原始 API 错误。

### Google Workspace

Google Workspace 没有本地 CLI 安装步骤。其连接向导先检查当前 JunQi 版本是否具备已注册的 Desktop OAuth 客户端、必要 API 与合法 redirect 配置，随后在系统浏览器使用 Authorization Code + PKCE 授权。浏览器回调必须只由受控本地 listener 或已注册 URI 接收，并校验 `state`、授权会话和发起设备。

能力不是一次性请求所有 Google scope。用户从“日历”“文件与共享”“邮件”“任务”等业务类别选择需要的能力集后，Adapter 计算该能力集的最小 scope 和 API 前置项，展示授权差异。已授权但 API 未启用、API 已启用但 scope 不足、管理员策略拒绝三种状态要分别呈现。Google 桌面应用不在前端或安装包中把 OAuth 客户端 secret 当作安全凭据。

## 能力目录与操作面

能力目录使用统一行式清单，不以平台名硬编码布局。每项 capability 包含：

| 字段 | 作用 |
| --- | --- |
| 业务名称与说明 | 来自 i18n 的平台中立业务表述，例如“读取日程”“创建审批实例”。 |
| effect | `read`、`write`、`high_impact`、`admin`。 |
| 可用性 | 已验证可用、需要授权、需要管理员配置、运行时不支持、暂时失败。 |
| 权限摘要 | 已获准 scope/role 的脱敏摘要和最近校验时间。 |
| 操作入口 | 查看、创建草稿、提交审批、打开平台原始页面等由 capability descriptor 决定。 |

写入操作不直接在列表行执行。点击后进入中间区域的操作草稿，按 `OperationPlan` 展示目标、身份、租户、输入摘要、影响范围、幂等和回读策略。用户确认后，右栏立即创建 Journal 项；执行结果只在权威状态重读完成后显示为“已确认”，否则为“结果待确认”。

对于审批、删除、外发邮件、共享权限变更、批量更新等高影响动作，确认页必须要求用户核对对象和影响范围。Agent 只能生成草稿或请求确认，不能自行完成高影响操作。

## 适配器与 UI 的分工

页面依赖通用 `BusinessIntegrationDescriptor`、`CapabilitySnapshot`、`OperationPlan` 和 `BusinessOperationJournal`，不能读取平台 SDK、CLI 输出或 OAuth token。推荐文件边界如下：

```text
src/business-integrations/domain/              领域类型、状态机、确认和 Journal 契约
src/business-integrations/adapters/            平台 descriptor、图标和 DTO 显示适配
src/business-integrations/services/            Registry、探测、授权会话、操作协调与记录查询
src/components/BusinessApplications/           页面装配，不直接访问 services
src/components/BusinessApplications/navigation/ 左侧目录与添加应用抽屉
src/components/BusinessApplications/detail/    标题、概览、能力和操作草稿
src/components/BusinessApplications/journal/   右栏、详情和跨平台记录查询
src-tauri/src/business_integrations/           typed command、密钥边界、Adapter 注册和参数验证
```

图标通过 `IntegrationDisplay.iconRef` 引用内部受控 SVG 或平台授权的静态资源。图标不是 Emoji，也不根据平台 ID 在 React 组件中散落条件判断。平台别名、显示名和提示文本必须进入 i18n catalog。

## 状态与视觉规范

- 使用现有 JunQi 主题 token，不为任一平台引入品牌色覆盖全局主题。
- 状态通过文本、图标和颜色三者共同传达；不能只靠颜色区分已连接、受阻和待确认。
- 保留上一次有效 capability snapshot，增量更新状态行，避免授权、刷新或 profile 切换时整个页面卸载重建。
- 表格、列表与操作面应使用稳定列宽和最小高度；长组织名、scope 或错误文案折行，不推挤操作按钮。
- 所有图标操作均有多语言 tooltip；常用主命令同时保留文字，避免仅用不熟悉图标。
- 无数据时显示当前能执行的恢复动作、最近成功探测时间和下一步，而不是空白大区域。

## 分阶段实施与验收

| 阶段 | 交付 | 验收证据 |
| --- | --- | --- |
| 0 | 通用页面骨架、Registry DTO、Journal 侧栏和状态组件 | 三种 mock descriptor 不触发平台条件分支；窄窗口和主题切换视觉回归通过。 |
| 1 | 钉钉 DWS Adapter 的探测、登录、profile、只读 capability catalog | 真实测试租户或脱敏运行时 fixture；未安装、登录过期、profile 失效和 schema 漂移均失败关闭。 |
| 2 | 飞书 Adapter 的应用配置、用户授权、身份区分与只读能力 | OAuth state/callback、scope 缺失、租户权限不足和 refresh 失效的契约测试。 |
| 3 | Google Workspace Adapter 的 Desktop OAuth、最小 scope 选择和 API 前置检查 | PKCE、redirect、scope 差异、API 未启用和管理员拒绝的端到端测试。 |
| 4 | 审批、日历、文档等写入能力与跨平台 Journal | 每项高影响操作有确认、幂等、回读、错误恢复和真实平台测试记录。 |

## 待验证事项

- JunQi 的发布身份、回调 URI 与桌面 OAuth 客户端注册策略，以及 macOS、Windows、Linux 的本地回调安全实现。
- 飞书自建应用和商店应用在目标企业中的权限审批、事件订阅和 token 保管模式。
- Google Workspace 管理员控制台、OAuth 验证、敏感 scope 审核与目标企业策略。
- 大夏集团的 DWS 版本、管理员允许的产品范围、请假模板与真实审批流程。
- 第二个平台的真实 Adapter 实现，用以验证 descriptor、CapabilityGate 和 Journal 设计未被 DWS 细节污染。
