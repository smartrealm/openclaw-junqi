# OpenClaw Cron 日历投影实施计划

## 执行顺序

1. 建立不带 Gateway 副作用的 Cron 下一次执行纯投影与行为测试。
2. 将日历条替换为下一次执行投影，并使用现有本地化的“下次运行”标签。
3. 将月视图替换为下一次执行日期投影。
4. 更新审计、规格、索引和验证记录，执行定向与全量检查后中文提交。

## 文件范围

- `src/pages/Calendar/cronProjection.ts`
- `src/pages/Calendar/cronProjection.test.ts`
- `src/pages/Calendar/CronStrip.tsx`
- `src/pages/Calendar/MonthView.tsx`
- `docs/README.md`
- `specs/README.md`
- `plans/README.md`
- 本轮 audit、spec、plan 与 validation Markdown

## 完成判据

- [x] 日历不再读取 `lastRun` 作为未来计划。
- [x] 两个视图共享 Gateway 下一次执行投影。
- [ ] 定向测试与 lint、diff 检查通过；完整验证进程的退出码仍待确认。
- [x] 真实 Gateway 与目标平台未验证边界被记录。
