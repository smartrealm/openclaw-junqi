# Cron 调度器状态与任务列表

日期：2026-08-03

## 依据

- 当前安装的 OpenClaw `2026.7.1-2` 类型声明 `CronStatusSummary` 与 Gateway `cron.status` handler。
- `cron.status` 的空参数契约为 `{}`，返回 `enabled`、`storePath`、`storage: "sqlite"`、`sqlitePath`、`jobs` 和 `nextWakeAtMs`。

## 当前行为

JunQi 定时任务页此前只读取 `cron.list`。任务列表存在不等于调度器正在运行，调度器被停用、状态读取失败和首次加载中无法区分。

## 目标行为

- 现有 Gateway cron 数据层与 `cron.list` 同步读取 `cron.status`。
- 页面明确展示读取中、调度器运行中、调度器已停用和状态不可用四种状态。
- `nextWakeAtMs` 存在时显示下一次唤醒的相对时间；没有下一次唤醒时不虚构时间。
- `storePath` 与 `sqlitePath` 只在类型化内存边界保留，不展示在 UI、日志或持久化数据中。
- `cron.status` 失败不丢弃已经成功读取的任务列表；状态单独显示为不可用。

## 验证结果

- `src/services/gateway/cronStatus.test.ts` 覆盖完整解码、非法存储类型、非法任务数、非法唤醒时间和精确 RPC 参数。
- Gateway 数据层测试覆盖 `cron.status` 结构化解析。
- `pnpm lint`、`pnpm test` 与 `git diff --check` 在本次修改后执行。

## 未验证边界

- 尚未在真实 Tauri Gateway 上验证当前凭据是否具备 `operator.read`，也未验证真实 SQLite 路径展示策略以外的控制台行为。
- 尚未完成亮色、暗色、窄窗口和调度器停用状态的人工视觉验收。
