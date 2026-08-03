# Cron 事件状态投影加固

日期：2026-08-03

## 依据

当前安装的 OpenClaw 版本为 2026.7.1-2 (0790d9f)。随包官方
docs/gateway/protocol.md 将 cron 定义为定时任务运行和任务变更事件；
随包 dist/server-cron-Cwg2hJro.js 实际广播 action 为 started、finished、
added、updated 和 removed。finished 事件携带 jobId、status、runAtMs、
durationMs、nextRunAtMs 和 deliveryStatus 等运行元数据。

## 发现的问题

JunQi 原先只处理 cron.run.started、cron.run.completed 和
cron.run.finished，并把 CronJob.state 对象覆盖成 running 或 idle 字符串。
Cron Monitor 后续读取 nextRunAtMs、lastRunStatus、lastDurationMs 等字段时，
这些字段已经丢失；当前安装版正式的 cron 事件也没有进入这条投影链路。

## 当前行为

- gatewayDataStore 处理官方 cron 事件的 started 和 finished action。
- 保留旧点号事件名作为兼容输入，但两条路径使用同一个投影函数。
- started 只更新 state.runningAtMs；若事件没有 runAtMs，使用本地观察时间标记正在运行，
  不伪造 Gateway 的完成时间。
- finished 清除 runningAtMs，并在字段存在且类型正确时更新 lastRunAtMs、
  nextRunAtMs、lastRunStatus、lastDurationMs、lastError 和 lastDeliveryStatus。
- Calendar 依赖的顶层 lastRun、lastRunStatus 和 lastDeliveryStatus 也从同一事件元数据更新。
- 事件中的 job、summary、命令和 payload 正文不会被复制到页面投影；error 只作为运行诊断写入
  lastError。
- malformed job id、状态和时间字段被忽略；CronJob 快照中的 state 必须是对象。
- Cron Monitor 的 active 数量通过统一的 getStatus 计算，使用 lastRunStatus 和 lastStatus
  的同一优先级规则。

## 验证

- node --import ./test-setup.ts --import tsx --test src/stores/gatewayDataStore.test.ts：6 项通过。
- pnpm exec tsc --noEmit --pretty false：通过。
- pnpm test：前端 2372 项、脚本 234 项全部通过。
- pnpm lint：通过；模块边界检查覆盖 802 个文件。
- pnpm build：通过，Vite 完成 9144 个模块，协作插件 bundle 校验通过。

## 未验证边界

- 未连接真实 Gateway 抓取 Windows、macOS 或 Linux 的 cron event 实时样本。
- 未在目标平台验证 Gateway 重启期间 started 事件缺失或 finished 事件重复时的视觉表现；
  这类情况仍以 cron.list 的下一次权威轮询为准。
- 旧版本 Gateway 的事件 action 如果不同于已核对的官方版本，必须先取得对应契约再扩展兼容。
