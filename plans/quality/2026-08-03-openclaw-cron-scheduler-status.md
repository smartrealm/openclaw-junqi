# OpenClaw Cron 调度器状态实施计划

## 执行顺序

1. 新建 `cron.status` strict client 与行为回归测试。
2. 将客户端绑定到现有 Gateway capability advertisement 和 method-not-found 语义。
3. 在 CronMonitor 的连接与刷新生命周期读取只读快照，并呈现有限字段与错误。
4. 更新本地化、审计、规格、验证和索引，执行验证后中文提交。

## 文件范围

- `src/services/gateway/OpenClawCronStatusClient.ts`
- `src/services/gateway/OpenClawCronStatusClient.test.ts`
- `src/services/gateway/index.ts`
- `src/pages/CronMonitor.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- `docs/README.md`
- `specs/README.md`
- `plans/README.md`
- 本轮 audit、spec、plan 与 validation Markdown

## 完成判据

- [x] `cron.status` 只通过官方无参数 RPC 调用，并严格解码。
- [x] UI 只显示调度器状态、任务数和下一次 wake，不泄露路径。
- [x] 失败、不支持、无效响应不会伪装成 disabled。
- [x] 定向测试、lint、官方链接和 diff 检查已通过；生产构建最终退出码及真机边界已记录为待复核。
