# 协作待决事项投影

日期：2026-08-02

## 依据

JunQi Collaboration Plugin `0.3.0` 已通过 `junqi.collab.run.list` 返回跨会话 Run 摘要，并通过 `junqi.collab.run.get` 返回完整 Run 快照。插件的 `allowedActionsForRun()` 将以下非终态作为需要操作者处理的状态：

- `AWAITING_APPROVAL`：`PLAN_REVISE`、`PLAN_APPROVE`、`CANCEL`。
- `AWAITING_INTERVENTION`：计划、工作项恢复、部分接受或取消动作。
- `DELIVERY_PENDING`：对账、重试、改投递目标、导出或明确放弃投递。

这些状态、Intervention 和允许动作仍由插件 SQLite 持久化；Desktop 不创建或推断新的决定事实。OpenClaw `2026.7.1-2` 的本机安装只作为插件宿主，本次不新增 OpenClaw 命令、事件或 SDK 调用。

## 当前行为

协作运行历史抽屉原先只列出 Run 摘要。审批、未解决 Intervention 和 Delivery 的处理入口分散在单个 Run 详情中，跨会话操作者无法先看到统一的待决列表。

## 目标行为

历史抽屉顶部新增“需要你决定”投影：

- 只包含上述三个插件权威状态，归档与终态运行不进入该区域。
- `AWAITING_INTERVENTION` 优先显示未解决 Intervention 的原始 `code` 和 `requiredAction`；尚未取得快照时显示明确的详情审阅提示，不伪造原因。
- 每项“查看”都复用既有 Run 详情和动作对话框。具体的批准、改派、重试、对账和放弃仍遵循 `allowedActions`、版本栅栏和服务端确认。
- 打开历史抽屉时，在全局摘要同步后仅补拉这三类状态的 Run 快照，避免把全量历史读成完整内容。

## 验证结果

- `CollaborationHistoryDrawer.test.tsx` 覆盖审批、未解决 Intervention、待交付和无待决状态。
- 待执行：本机 Desktop 视觉与交互验收。自动化静态渲染不能证明真实窗口中的滚动、焦点和动作对话框布局。

## 未验证边界

- 不改变插件数据库、RPC scope、OpenClaw Task 或渠道投递协议。
- 在离线、插件缺失、实例身份变化时，既有协作投影失效和错误处理仍生效；本次没有以本机 Gateway 状态推断其他环境可用性。

## 协调关联

Task Brief 新增 `collaboration-run` 显式引用类型，用于记录简报与协作 Run 的关系。它只保存用户填写的显示标签和 Run identity，并沿用既有引用校验与 Markdown 编译；不会读取 Run 内容、触发 OpenClaw Task、改变协作 Run 状态或充当任务调度器。

## 最终产物展示

插件的 FinalArtifact 权威投影包含完整 `content`、`sourceAttemptId`、`digest` 和 `createdAt`。Desktop 原先复用通用 metadata 摘要组件，导致超过 180 字的产物正文被静默截断。现在最终结果使用独立只读渲染器：完整正文在有界滚动区域中按原文本换行展示，同时保留来源执行尝试、摘要和创建时间。该变化不修改产物、Evidence 或 Delivery 协议。
