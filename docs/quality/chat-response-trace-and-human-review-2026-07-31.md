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

- 定向执行追溯与共享侧栏测试通过：5 项通过，0 项失败。
- `pnpm lint` 通过；模块边界检查覆盖 657 个文件。
- `pnpm test` 通过；前端、脚本与既有回归测试均未报告失败。
- `pnpm build` 通过；9002 个模块完成转换，未报告循环分包或 chunk 预算警告。
- `git diff --check` 在最终检查中执行。
- 未执行 Tauri 真机点击验收、真实 Gateway 长任务、历史重载和正式协作审批流程，因此这些边界不记为已验证。
