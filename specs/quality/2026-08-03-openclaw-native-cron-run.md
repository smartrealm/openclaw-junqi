# OpenClaw 原生 Cron 运行语义规格

## 目标

使 JunQi Cron 页面忠实表达 OpenClaw 手动运行的 enqueue 与 completion 边界，而不是将 RPC 返回伪装为任务完成。

## 约束

- 只使用当前官方 `cron.run`、`cron.runs` schema、handler、CLI 与 protocol 证据。
- `cron.run` acknowledgement 不是 terminal result；只以 exact `runId` history entry 的 `ok`、`error`、`skipped`
  作为终态。
- adapter 必须严格校验官方已知字段；未知扩展字段不进入 JunQi 领域模型。
- UI 不得将读失败、超时、断线、不支持、排队或 running 显示为成功、空历史或本地完成。
- 未取得 schema 的 cron event payload 只能触发权威读取，不得覆盖 `CronJob.state` 或补造时间。
- 不创建、恢复、重试、取消或修改任何 OpenClaw Cron run。

## 验收条件

1. `cron.run` 只有明确 `ok && enqueued && runId` 才进入 pending 状态。
2. `cron.runs` 轮询请求同时携带 exact job id、run id 和 `limit: 1`；只有官方 terminal status 结算当前操作。
3. 读取响应、缺失 run id、超时和 Gateway 错误都有不同可见状态。
4. 历史读取由 typed decoder 处理，错误不再静默变为空列表。
5. 旧 `cron.run.*` 事件不再改写 Gateway job projection；`cron` event 只刷新。
6. 回归测试覆盖 enqueue、exact poll、三种终态、malformed response、读取失败和事件刷新边界。

## 不在范围内

- `cron.status` result UI、实时 event 字段投影、Cron 创建表单的完整 schema。
- 真实 Gateway 和目标桌面平台人工验收。
