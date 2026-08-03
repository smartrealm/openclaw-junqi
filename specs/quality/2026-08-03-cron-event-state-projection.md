# Cron 事件状态投影规格

日期：2026-08-03

## 问题

Gateway 事件到达后，JunQi 必须更新定时任务的运行态，同时保留 OpenClaw
CronJob state 对象。将 state 替换成展示字符串会让下一次运行时间、最近状态和耗时
在事件后消失；只监听旧事件名还会漏掉当前 OpenClaw 的官方 cron 事件。

## 目标行为

1. 识别官方 event: cron 的 action started 和 finished。
2. started 只设置 runningAtMs，并保留已有 state 字段。
3. finished 清除 runningAtMs，并仅投影官方事件中存在且通过类型校验的运行元数据。
4. 同时保留旧点号事件名的输入兼容，不能产生第二套状态规则。
5. 任何 malformed id、时间或枚举值都不得覆盖现有状态。
6. 页面统计必须复用 Cron Monitor 的正式状态判断，而不能用另一套 lastStatus 逻辑。

## 约束

- OpenClaw 2026.7.1-2 的 protocol.md 和本机 dist 代码是事件契约来源。
- 事件投影只允许 metadata；不得把任务 payload、命令、消息正文写入页面状态。
- started 缺少 runAtMs 时的本地时间只表示观察到事件，不代表 Gateway 运行终态。
- cron.list 轮询仍是完整任务快照的权威来源。

## 验收条件

- 官方 started/finished 事件回归测试证明 state 对象和既有字段不丢失。
- finished 事件能更新 run time、status、duration、next run 和 delivery status。
- 旧点号事件名通过相同投影规则。
- malformed state 快照被拒绝，不再允许字符串 state 进入 Cron Monitor。
- TypeScript、边界检查、相关测试和差异检查通过。
