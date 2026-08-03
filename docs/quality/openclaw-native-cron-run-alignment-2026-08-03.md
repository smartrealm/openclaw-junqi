# OpenClaw 原生 Cron 运行语义审计

日期：2026-08-03

## 依据

本轮仅使用当前 OpenClaw 官方文档、Gateway protocol schema、Gateway handler 与 CLI 源码作为契约。

- [`cron.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/packages/gateway-protocol/src/schema/cron.ts)
  定义 `cron.run` 参数、`cron.runs` 的 `runId` filter，以及终态 run log 的 `ok`、`error`、`skipped`。
- [`server-methods/cron.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/src/gateway/server-methods/cron.ts)
  说明 `cron.run` 调用 Gateway `enqueueRun`，`cron.runs` 从持久 history 读取记录。
- [`register.cron-simple.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/src/cli/cron-cli/register.cron-simple.ts)
  是官方 CLI 的完成语义参照：仅在 `ok && enqueued && runId` 后轮询 exact `cron.runs`；只接受
  `ok`、`error`、`skipped` 作为终态。
- [`cron-jobs.md`](https://github.com/openclaw/openclaw/blob/main/docs/automation/cron-jobs.md)
  明确 `automations run` 在入队后返回；需要完成语义时必须轮询返回的 `runId`。
- [`gateway/protocol.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
  将 `cron` 列为 Gateway 事件族，但当前本轮未取得可用于字段投影的 event payload schema。

## 问题分级

### BUG-CRON-RUN-01 高：入队被展示为执行成功

位置：`src/pages/CronMonitor.tsx`

当前 `runJob()` 在 `cron.run` RPC 不抛错后立刻写入 `runResult: 'ok'`，按钮显示完成图标，并只在两秒后
按 job id 拉取 history。当前官方契约中 `cron.run` 是 enqueue RPC；非终态拒绝、排队中、执行中、失败和 skipped
均可能发生在该返回之后。

影响：用户会把未开始或失败的后台任务误认为已完成。

修复：严格解码官方 enqueue acknowledgement。只有 `enqueued: true` 和非空 `runId` 才进入等待状态；以
`cron.runs { id, runId, limit: 1 }` 轮询 exact run。只有持久记录的 `ok`、`error`、`skipped` 才是 UI 终态。

### BUG-CRON-RUN-02 高：run history 缺少 schema decoder、runId 关联和错误状态

位置：`src/pages/CronMonitor.tsx`

当前页面将 `gateway.call('cron.runs')` 的未知结果按 `result?.entries || []` 和 `any` 投影；所有读取异常被静默
吞掉，手动运行后也没有保留 `runId`。这使错误响应、错误条目和其他运行记录都能被混入或隐藏。

影响：界面没有可验证的“当前这一次运行”身份，错误可能被显示为空历史或其他任务的旧成功记录。

修复：建立严格的只读 cron run adapter，验证 `entries`、`jobId`、时间、状态与可选 `runId`。等待路径只能读取
指定 job 与 run id；历史视图保留独立错误状态，不将读取失败伪装成空列表。

### BUG-CRON-RUN-03 中：旧事件名在本地伪造 Cron 状态

位置：`src/stores/gatewayDataStore.ts`

当前数据层处理 `cron.run.started`、`cron.run.completed` 与 `cron.run.finished`，并将 job 的官方 `state` object
替换为本地字符串，或用客户端当前时间伪造 `lastRun`。当前官方 protocol 只证明存在 `cron` 事件族；本轮没有
取得这些旧事件及 payload 的当前 schema。

影响：本地状态可能覆盖 Gateway 的权威 state，并在事件名或字段漂移时显示虚假运行状态。

修复：删除未经当前官方 schema 证明的局部状态投影。收到官方 `cron` 失效事件时只刷新已存在的权威
`cron.list` projection，不制造字段或时间；未验证 payload 不进入领域状态。

## 目标行为

- Cron 页面只将 Gateway 历史记录中的 `ok`、`error`、`skipped` 作为终态。
- `cron.run` 的入队确认、等待中、终态、超时、断线、不可用和读取失败保持不同状态，不互相伪装。
- 每个手动启动动作绑定 Gateway 返回的 `runId`；其他 job 或其他 run 的记录不能结算它。
- 通用 run history 是只读列表，不代替当前 run 的确认通道。
- `cron` event 只用于刷新当前 Gateway projection；不根据未验证 payload 制造 local state。
- 当前界面以官方 CLI 的默认十分钟上限、两秒轮询周期等待终态；这是 JunQi 的等待界面策略，不是
  Gateway 协议字段或对 Gateway 执行时长的承诺。
- 本轮不接入 `cron.status` UI；后续审计已从官方 Cron service source 取得结果模型，并在
  [Cron 调度器状态对齐](openclaw-cron-scheduler-status-alignment-2026-08-03.md) 中单独实现。

## 未纳入本轮

- Cron job 创建表单的完整 payload、delivery、trigger、pacing、scratch 和 status UI。
- 未经当前 event schema 证明的实时运行进度。
- 本地重试、取消、补偿或对 cron job 生命周期的推断。
- 真实 Gateway、Windows、macOS、CentOS、Ubuntu 长时任务的手工验收。

## 验证结果

2026-08-03 已通过以下自动化验证：

- `node --import ./test-setup.ts --import tsx --test src/services/gateway/OpenClawCronRunClient.test.ts src/stores/gatewayDataStore.test.ts`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm verify:openclaw-docs`，校验 55 条官方 OpenClaw 链接和锚点
- `git diff --check`

`OpenClawCronRunClient.test.ts` 覆盖 enqueue acknowledgement、exact job/run history filter、三种官方终态、
空 history、无效响应、显式能力缺失和 Gateway method-not-found。`gatewayDataStore.test.ts` 覆盖旧 cron
事件不能篡改已有 job state，以及 `cron` 事件只触发权威 `cron.list` 刷新。

## 未验证边界

尚未连接真实 Gateway 手工验证多分钟运行、断线重连、`skipped`、权限拒绝和历史持久化，也未在 Windows、
macOS、CentOS 或 Ubuntu 真机验证桌面渲染与长时轮询。此次自动化结果不代表这些环境已经验收。
