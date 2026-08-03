# OpenClaw Cron 调度器状态对齐

日期：2026-08-03

## 依据

- OpenClaw 官方 [`cron.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/packages/gateway-protocol/src/schema/cron.ts) 定义无参数 `CronStatusParamsSchema`。
- OpenClaw 官方 [`server-methods/cron.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/src/gateway/server-methods/cron.ts) 验证请求后将 `context.cron.status()` 的结果原样返回。
- OpenClaw 官方 [`ops-read.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/src/cron/service/ops-read.ts) 明确返回 `enabled`、`storage`、`jobs` 和 `nextWakeAtMs`，并将 `storePath`、`sqlitePath` 作为主机内部位置。
- OpenClaw 官方 [`types.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/src/cron/types.ts) 定义 `CronStatusSummary`：`enabled: boolean`、`storage: "sqlite"`、`jobs: number`、`nextWakeAtMs: number | null`。
- OpenClaw 官方故障排除文档要求 `cron status` 用于确认 scheduler enabled 与 next wake。

## 当前行为

JunQi `CronMonitor` 只读取 `cron.list` 和 run history。列表可说明任务定义，却不能区分“所有任务都已暂停”与“Gateway 调度器整体已禁用”，也没有 Gateway 维护的下一次 wake。

## 问题分级

### BUG-CRON-STATUS-01 中：缺少原生调度器状态来源

位置：`src/pages/CronMonitor.tsx`、`src/services/gateway/`。

影响：用户不能从桌面端获得官方 scheduler enabled/disabled 状态，排障需离开 JunQi 使用 CLI；页面可能把任务存在误解为调度器处于启用状态。

## 目标行为

- 通过严格解码的 `cron.status {}` 只读 RPC 呈现 Gateway 调度器快照。
- 只展示 `enabled`、`jobs` 与 `nextWakeAtMs`；不将主机 SQLite 文件路径传入 UI、日志或持久化。
- 仅在页面连接建立和用户点击刷新时读取。未取得事件 payload 或订阅契约前，不制造实时状态。
- Gateway 未广告该方法、method-not-found、无效响应、断线和读取错误应保持真实错误语义，不伪装成 disabled 或零任务。

## 未纳入本轮

- scheduler enable/disable 写操作、SQLite 管理、路径浏览。
- 任何本地 Cron service、cron expression 解析或实时 event 投影。
- 真实 Gateway、Windows、macOS、CentOS、Ubuntu 真机验收。
