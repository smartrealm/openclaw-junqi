# OpenClaw Cron 任务详情与运行回溯对齐

日期：2026-08-03

## 依据

当前安装的 OpenClaw 版本为 `2026.7.1-2 (0790d9f)`。本轮核对随包
`docs/gateway/protocol.md`、`docs/cli/cron.md`、`schema-BuOFpc7K.js`、
`cron-BXksovqf.js` 与 `run-log-DIhrTrSU.js`：

- `cron.get` 接受 `{ id }` 或兼容别名 `{ jobId }`，返回完整的 `CronJob` 读模型。
- `cron.runs` 是按任务分页的运行日志查询，支持 `runId`、`limit`、`offset` 和排序；每条记录
  的 `action` 必须为 `finished`，执行状态来自 `ok`、`error` 或 `skipped`。
- `cron.run` 是入队操作。入队成功时返回 `enqueued: true` 与唯一 `runId`，并不等待执行完成。
  官方 CLI 的 `--wait` 语义也是先入队，再按该 `runId` 轮询 `cron.runs`。

## 当前实现

JunQi 在 `src/services/gateway/cronRuns.ts` 中建立严格的协议边界：

- `cron.get` 只保留页面需要的安全详情投影，验证任务身份、调度、运行状态和 payload kind，
  不把 payload 内容写入页面状态；
- `cron.runs` 强制 job scope，验证分页元数据、运行记录和状态联合类型；
- `cron.run` 入队结果要求 `enqueued` 响应包含 `runId`；
- `waitForCronRun` 只接受目标 `runId` 的终态，超出 120 秒报告明确超时，不把同一任务的其他
  最近记录误认成当前执行结果。

`CronMonitor` 选中任务后读取 `cron.get`，运行历史使用分页 `cron.runs`，立即运行使用
`cron.run` 加精确 `runId` 回溯。运行中、成功、失败、跳过和等待超时在页面上保持不同状态。

## 验证结果

- `src/services/gateway/cronRuns.test.ts` 覆盖安全详情投影、参数信封、分页解析、异常状态、
  精确 runId 轮询和超时边界。
- `pnpm exec tsc --noEmit` 通过。
- `cronRuns.test.ts`、`cronStatus.test.ts` 与 `gatewayDataStore.test.ts` 通过。
- locale JSON 解析与 `git diff --check` 通过。

## 未验证边界

- 未连接真实 Gateway 执行定时任务，未验证当前凭据在目标环境的 `operator.read` / `operator.write`。
- 未在 Windows、Linux 和 macOS 制品上人工验收 Cron Monitor 的窄窗口、调度器停用和长时间等待布局。
- 旧版本 Gateway 若不返回分页元数据或 `cron.run.runId`，当前实现会明确报协议错误，不猜测兼容结果；
  是否需要兼容旧版本需取得该版本官方契约后另行立项。
