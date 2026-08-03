# 全局协作 Activity 与 Needs You

## 问题

JunQi 的协作历史只在 Chat 内刷新。Activity Center 具备会话、工作台任务、Gateway task ledger 和审批入口，但无法发现协作插件返回的计划审批、人工介入或交付待处理状态，跨入口会断层。

## 依据

- 协作插件 `junqi.collab.run.list`、`junqi.collab.run.get` 和 `junqi.collab.tombstone.list` 是当前协作运行状态的权威来源。
- `CollaborationRunSummary.status` 仅按 `AWAITING_APPROVAL`、`AWAITING_INTERVENTION`、`DELIVERY_PENDING` 投影为 Needs You。
- `CollaborationRunSnapshot.interventions` 只用于补充同一版本快照中的未解决 intervention code 和 requiredAction。
- 运行时身份必须已经由当前已验证 Gateway 连接绑定；不能复用其他连接的 store 投影。

## 目标行为

1. AppRoutes 挂载一个无 UI 的协作 Activity runtime，在连接和 runtime identity 均验证后同步全局运行摘要和 tombstone。
2. 全局同步只读，不创建、修改、删除运行；变更提示用于加速刷新，定时读取仍是正确性路径。
3. Activity Center 和 Chat 协作历史抽屉使用同一投影函数，状态和文案不分叉。
4. Activity Center 点击协作条目时携带真实 `runId` 进入 Chat；Chat 只打开该 run 的权威详情，不复制数据。
5. 断开连接、身份不可验证或实例切换时，不继续显示旧连接的运行状态。

## 验收条件

- 无有效 Gateway/runtime identity 时不发出全局协作读取，也不渲染旧投影。
- 只有三个权威待决状态出现在 Activity Center 的 Needs attention 过滤中；`RUNNING`、`COMPLETED` 等状态不会误报。
- `AWAITING_INTERVENTION` 只有在快照 revision 不低于 summary revision 时才使用快照中的未解决 intervention；否则使用通用提示。
- Activity Center 入口生成 URL 编码后的真实 runId，Chat 消费后移除一次性查询参数。
- tombstone 中的 run 不出现在 Activity Center，也不绕过协作插件删除语义。
- 读取失败不会伪造成功或清空其他 Activity 数据；下一次提示或轮询可重试。

## 不在范围内

- 不新增通用 Agent-to-Agent message、Topic、Domain Agent 或主 Thread 数据模型。
- 不改变协作插件写入协议、权限、凭据和运行状态机。
- 不把 Activity Center 的本地会话状态反写回 OpenClaw 或协作插件。

## 未验证边界

- 自动化验证已通过；真实多实例 Gateway、运行时重启期间的 UI 观测和目标平台事件桥仍待手工验收。
