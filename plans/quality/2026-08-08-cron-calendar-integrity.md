# Cron 与日历提醒完整性实施计划

## 顺序

1. 核对 OpenClaw 主线 Cron schema、descriptor 和 Gateway 请求边界。
2. 将 Cron 执行与运行记录读取拆成管理员、读取两个服务依赖，并补充回归测试。
3. 将日历提醒时间计算抽为纯调度构建器，覆盖跨午夜、固定间隔和不可表达规则。
4. 将提醒内容和 Cron 模板移出状态层与页面，接入运行时语言和时区。
5. 拆分 Cron 页面纯展示逻辑，保持页面只负责状态编排与用户操作。
6. 为可重试的日历 Cron 创建传递官方 `declarationKey`，让 Gateway 收敛未知写入结果，并增加回归测试。
7. 为 CronMonitor 的模板和手动创建保留未确认意图的声明键，确认读回后才释放，并增加回归测试。
8. 更新语言资源、验证文档和 `PROJECT_STATUS.md`，执行定向测试、类型检查、边界检查、全量测试和构建。

## 文件范围

- `src/services/gateway/OpenClawCronRunClient.ts`
- `src/services/gateway/OpenClawCronRunClient.test.ts`
- `src/services/gateway/index.ts`
- `src/pages/Calendar/cronReminderSchedule.ts`
- `src/pages/Calendar/cronReminderSchedule.test.ts`
- `src/pages/Calendar/calendarReminderContent.ts`
- `src/stores/calendarStore.ts`
- `src/pages/cronPresentation.tsx`
- `src/pages/CronMonitor.tsx`
- `src/locales/zh.json`
- `src/locales/en.json`
- `src/locales/zh-TW.json`
