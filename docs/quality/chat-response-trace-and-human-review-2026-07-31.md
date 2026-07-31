# Chat 响应追溯与人工审核

日期：2026-07-31

## 协议依据

- OpenClaw `2026.7.1` 的 Chat 工具事件提供 `sessionKey`、`runId`、`seq`、`toolCallId`、工具名称、参数与阶段。
- OpenClaw `update_plan` 提供计划快照，但不提供稳定的 `planId`、Step ID 或“工具调用属于哪个步骤”的关联字段。
- Gateway transcript 是普通 Chat 的历史权威来源。JunQi 不从 Thinking、回复文本或相邻用户消息猜测审核关系。
- JunQi Collaboration Run 是正式工作流的持久化权威来源，已经保存计划修订、决策、干预、证据和有序审计事件。

## 当前问题

- Chat 内部保留响应组和运行标识，但没有用户可到达的响应级追溯入口。
- 计划卡只显示最新计划和修订数量，不能查看原始计划快照序列。
- 工具卡显示输入与输出，但没有统一展示 `runId`、`sourceSequence` 和 `toolCallId`。
- 普通 Chat 的结构化选项会发送一条用户消息，但没有审核请求 ID、审核人和审核决策关联，不能描述为正式审核记录。

## 目标行为

- 每个助手响应组在统一 Footer 中提供执行追溯入口。
- 右侧追溯面板展示权威来源、响应状态、时间范围和完整结构化节点序列。
- 计划快照、Thinking、工具调用、人工选择请求、文件产物、会话事件和最终回复保持原始顺序。
- 工具节点展示可用的 `sourceSequence` 与 `toolCallId`，没有上游字段时明确显示未提供，不生成替代值。
- 普通 Chat 的人工选择请求标记为 transcript-only，不声明存在正式审批记录。
- 正式审核继续使用 Collaboration Run 的 `plan_revisions`、`decisions`、`interventions` 与 `collaboration_events`，Chat 追溯面板只提供进入协作历史的入口，不复制第二套数据库。
- 消息预览与执行追溯共用一个 Chat 侧边面板状态和外壳，同一时刻只打开一种详情。

## 不推断边界

- 不把下一条用户消息自动关联为某个选择请求的审核结果。
- 不把工具调用自动归属到某个计划步骤。
- 不把本地派生的响应组 ID 描述为 OpenClaw 原生 Trace ID。
- 不把 Chat transcript 描述为具备 actor、decision type 和 revision fence 的正式审批账本。

## 验证边界

- 自动化覆盖结构化投影、顺序、标识保留、审核语义和两个 Chat 入口的共享面板。
- 真实 Gateway 长任务、历史重载、协作审批和 Tauri 窄窗口仍需要桌面人工验收。

## 验证结果

## 2026-07-31 追溯语义化与来源记录下钻

### 依据

- OpenClaw Gateway Protocol 规定 `chat.history` 是面向 UI 的 display-normalized transcript；`chat.message.get` 只能读取先由该 transcript 提供的单条原生消息标识。
- `agents.list` 返回的 Agent 配置是显示名称的权威来源；会话键只用于路由，不能作为默认用户文案。

### 当前行为与目标行为

- 原行为：追溯摘要直接显示 session key、派生 trace ID 和原生 source message ID，用户无法区分这些内部标识的含义。
- 目标行为：摘要显示 Agent 名称、当前会话和原始会话记录数量；每个阶段默认只显示语义名称、状态和时间。内部标识保留在可展开的技术详情。
- 来源记录支持下钻：在当前已加载 transcript 中精确匹配到的记录展示其角色、时间与可读内容；没有加载到的记录明确显示不可用，不根据标识猜测或合成内容。

### 未验证边界

- 该变更不新增 Gateway RPC，也不把本地展示 ID 当作 `chat.message.get` 参数。
- 真实 Gateway 的历史分页后来源记录下钻仍需在桌面应用中人工验收。

### 本次验证结果

- `pnpm lint` 通过，模块边界检查覆盖 676 个文件。
- 追溯、侧栏、消息输入和 Chat 生产约束定向测试共 29 项通过。
- `pnpm test` 全量前端与脚本测试通过。
- `pnpm build` 通过，并重新校验协作插件包契约与固定 SHA-256。
- `git diff --check` 和本次修改文件的 Emoji 扫描通过。

- 定向执行追溯与共享侧栏测试通过：5 项通过，0 项失败。
- `pnpm lint` 通过；模块边界检查覆盖 657 个文件。
- `pnpm test` 通过；前端、脚本与既有回归测试均未报告失败。
- `pnpm build` 通过；9002 个模块完成转换，未报告循环分包或 chunk 预算警告。
- `git diff --check` 在最终检查中执行。
- 未执行 Tauri 真机点击验收、真实 Gateway 长任务、历史重载和正式协作审批流程，因此这些边界不记为已验证。

## 2026-07-31 工具来源记录格式化修复

### 原因

工具来源记录同时保留原始 transcript 文本和已标准化的 `toolOutput`。原面板错误地优先渲染原始文本，导致 transport JSON、转义换行和外部内容包装直接出现在 Markdown 内容中。

### 修复

- 工具记录优先使用 `toolOutput`，仅在该字段缺失时回退到已加载记录的 `content`。
- 可解析的 JSON 以字段和值呈现，字符串值保留真实换行并使用可滚动等宽区域；非 JSON 输出保持可滚动文本区域。
- 不可用提示改为准确描述当前已加载历史范围或上游清理状态，不再建议一个 UI 中不存在的重新加载操作。

### 验证边界

- 自动化覆盖工具输出优先级、结构化 JSON 识别和空记录失败关闭。
- 尚未在真实 Gateway 的大体积外部工具结果及历史分页场景完成桌面真机验收。
