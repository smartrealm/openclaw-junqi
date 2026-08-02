# 业务应用 UI 与 Chat 双入口规格

日期：2026-08-02

## 目标

新增“业务应用”顶级工作区，使企业协作平台能力可以被人和 AI 以同一套权限、确认和追溯边界使用。

## 当前范围

- 顶部导航位于“智能体”之后，路由为 `/business-applications`。
- 页面使用应用目录、应用详情、操作记录三栏布局。
- 初始 descriptor 包含钉钉工作台、飞书、Google Workspace；它们均是展示状态，不代表真实运行时已接入。
- 能力行的“交给 AI 规划”将结构化平台和能力上下文写入当前会话草稿，然后导航至 Chat。
- 页面不得伪造运行时探测、OAuth 成功、profile 选择、审批写入或平台回执。

## 双入口约束

1. 人操作从业务应用目录进入能力和操作草稿，写操作必须经过 `OperationPlan`、显式确认和 Journal。
2. AI 操作从 Chat 中读取脱敏 capability snapshot，或由业务页将用户可见上下文交给 Chat；AI 只能生成计划和请求确认。
3. 人与 AI 使用同一个 `BusinessOperationCoordinator`、`CapabilityGate`、`ConfirmationPolicy` 和 `BusinessOperationJournal`；任何实现不得建立绕过确认的第二条执行路径。
4. Chat 草稿只包含用户可见的平台名称和能力名称，不得写入 token、完整 profile、租户标识或原始业务正文。

## 验收条件

1. `/business-applications` 被独立 feature flag 守卫，并在顶部导航显示。
2. 所有平台布局通过 descriptor 驱动，页面组件不依据平台 ID 渲染业务分支。
3. 目录切换、概览、能力和操作标签可交互；没有运行时的能力操作展示准确的前置状态。
4. “交给 AI 规划”保留用户已有草稿，并追加可审阅的规划请求后导航到 `/chat`。
5. 新界面所有可见文案均来自三种当前语言资源；图标来自项目已有图标库，未使用 Emoji。
6. 真正 Adapter 接入前，不宣称可连接、可读取或可写入第三方平台。
