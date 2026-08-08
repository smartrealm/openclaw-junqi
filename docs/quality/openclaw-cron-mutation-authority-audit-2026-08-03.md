# OpenClaw Cron 写操作授权与一致性审计

日期：2026-08-03

## 依据

- OpenClaw [官方 schema 源码](https://github.com/openclaw/openclaw/blob/fbc45c9b/packages/gateway-protocol/src/schema/cron.ts)：`cron.add`、`cron.update`、`cron.remove` 使用闭合参数 schema；[core descriptors](https://github.com/openclaw/openclaw/blob/fbc45c9b/src/gateway/methods/core-descriptors.ts) 将三者标为 `operator.admin`。
- OpenClaw [官方 Gateway handler](https://github.com/openclaw/openclaw/blob/fbc45c9b/src/gateway/server-methods/cron.ts)：`cron.remove` 仅在服务返回 `{ ok: true, removed: true }` 时才响应成功。
- 当前安装的 OpenClaw `2026.7.1-2`：随包 `docs/cli/cron.md` 明确所有 Cron mutation 需要 `operator.admin`，并导出同一类 add、update、remove 方法。
- JunQi 当前链路：`src/services/gateway/index.ts` 的普通 `gateway.call()` 使用日常连接；该连接默认只请求 `operator.read` 和 `operator.write`。`CronMonitor.tsx` 与 `calendarStore.ts` 都通过该入口执行 Cron mutation。

## 审计范围

- `src/services/gateway/index.ts`
- `src/services/gateway/Connection.ts`
- `src/services/gateway/cronContract.ts`
- `src/pages/CronMonitor.tsx`
- `src/stores/calendarStore.ts`

## 问题分级

### BUG-CRON-MUTATION-01 严重：Cron 写操作未进入官方管理员授权通道

位置：

- `src/pages/CronMonitor.tsx:504,557,576,1222`
- `src/stores/calendarStore.ts:55,73`
- `src/services/gateway/index.ts:1096`

当前行为：CronMonitor 与日历提醒使用普通 `gateway.call()`。该调用复用默认 `operator.read` 和 `operator.write` 连接，而官方 `cron.add`、`cron.update`、`cron.remove` 要求 `operator.admin`。

影响：

- 已连接的桌面客户端可能因权限不足而被 Gateway 拒绝创建、更新或删除任务；
- 调用方直接使用宽泛的 `any` 请求与未知响应，不能将权限、能力缺失与无效返回正确区分；
- 页面切换任务启停时吞掉异常，用户会看到旧状态却没有失败依据。

目标：以现有一次性 `requestPrivileged` 管理员通道调用官方 Cron mutation；客户端只发送闭合的当前 UI 所需字段，能力明确缺失和 Gateway method-not-found 显式表示为不支持，其他错误继续向 UI 或调用方传播。

CronMonitor 已支持创建、启停、运行和 Agent 路由，但没有删除入口；这使用户只能离开桌面客户端改用官方 CLI 管理既有任务。删除入口必须先取得用户确认，只把 `{ ok: true, removed: true }` 视为远端删除成功，并在刷新任务列表失败时明确说明读回未确认。

### BUG-CRON-MUTATION-02 严重：日历在远端 Cron 删除未确认时丢失本地关联

位置：`src/stores/calendarStore.ts:71-77,234-278`

当前行为：`removeCronReminder()` 捕获全部异常且始终返回。更新事件会先持久化本地新值，再尝试删除旧任务并创建新任务；删除事件也会在远端删除失败后移除本地事件。旧判定还遗漏 recurrence、全天、结束时间、地点、备注和投递频道等会改变 reminder schedule 或 prompt 的字段。

影响：

- Gateway 拒绝、断开或返回非成功删除结果时，原任务继续运行而本地记录已被更新或删除；
- 后续同步没有稳定的 job id 可用于清理，可能出现重复提醒或孤立提醒；
- 本地界面把远端副作用描述为已处理，违反不能伪造成功的约束。

目标：只有解析到官方成功删除结果后才允许丢弃本地 Cron 关联。需要替换提醒时，先确认旧任务已删除，再写入本地更新并尝试创建新任务；新建失败保留 `pending`，不伪装为已计划。删除失败保留本地事件和关联，并向状态写入可见错误。所有影响 reminder schedule 或 prompt 的字段变化都必须触发同一替换流程。全天或没有开始时间的事件不符合当前 `createCronReminder()` 的创建条件，必须标记为 `none` 而非永远无法完成的 `pending`。

## 不在本轮范围

- 不实现或猜测 Cron 的 command payload、webhook、投递目标、trigger、pacing、scratch 或模型覆盖编辑器；当前界面没有完整的官方字段编辑契约。
- 不把日历本地事件改成 Gateway 的权威实体；本轮只修复已有本地事件与其已创建 Cron job 的副作用一致性。
- 不把管理员 token 写入前端持久化状态；继续使用既有短生命周期 transient connection 和授权错误处理。

## 后续校正（2026-08-08）

本文件记录的是 2026-08-03 的历史审计结论。随后已按 OpenClaw 官方协议补充 `cron.run` 的权限核对：
`cron.get`、`cron.list`、`cron.status`、`cron.runs` 使用 `operator.read`，`cron.add`、`cron.update`、
`cron.remove`、`cron.run` 使用 `operator.admin`。当前实现与详细验证证据见
`docs/quality/openclaw-cron-calendar-integrity-2026-08-08.md`。
