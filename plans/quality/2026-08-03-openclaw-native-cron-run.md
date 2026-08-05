# OpenClaw 原生 Cron 运行语义实施计划

## 执行顺序

1. 新建 cron run adapter，处理官方 enqueue acknowledgement、exact history page 与 terminal 判定。
2. 为 adapter 添加旧实现会失败的协议回归测试。
3. 替换 CronMonitor 的 raw `gateway.call` 和本地成功标记，保留 runId scoped polling、错误与超时状态。
4. 删除未证实的旧 cron event state mutation，改为 `cron` 事件后的权威 list refresh。
5. 补充页面状态回归、locale、审计索引与验证记录。
6. 执行定向、全量、构建、官方链接、diff 和 Emoji 验证后中文提交。

## 文件范围

- `src/services/gateway/OpenClawCronRunClient.ts`
- `src/services/gateway/OpenClawCronRunClient.test.ts`
- `src/services/gateway/index.ts`
- `src/pages/CronMonitor.tsx`
- `src/pages/CronMonitor.test.tsx`
- `src/stores/gatewayDataStore.ts`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- `docs/README.md`
- `specs/README.md`
- `plans/README.md`
- 本轮 audit、spec、plan 与 validation Markdown

## 完成判据

- [x] 手动运行不再把 enqueue 显示为完成。
- [x] 当前 run 只由 exact runId 的持久 terminal record 结算。
- [x] 历史与轮询响应严格解码，错误状态真实可见。
- [x] 未证实的 cron event 不再制造或覆盖本地 job state。
- [x] 测试、构建和文档验证全部通过，并记录未验证真机边界。
