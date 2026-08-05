# OpenClaw Cron 日历投影验证记录

日期：2026-08-03

## 自动化证据

以下命令在本轮修改后已完成并通过：

- `node --import ./test-setup.ts --import tsx --test src/pages/Calendar/cronProjection.test.ts`
- `node --import ./test-setup.ts --import tsx --test src/pages/Calendar/cronProjection.test.ts src/stores/gatewayDataStore.test.ts src/services/gateway/OpenClawCronRunClient.test.ts`，共 35 项通过。
- `pnpm lint`，包含模块边界、版本一致性与 `tsc --noEmit`。
- `git diff --check`。

新回归测试验证顶层 `nextRunAtMs` 优先、同一官方模型的嵌套 state fallback、非法字段拒绝、禁用和过期任务过滤、排序及最近运行状态投影。

## 仍在确认的完整验证

本轮已启动 `pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`、`pnpm test:rust`、`pnpm collab:test` 和 `pnpm collab:validate`。执行环境同时存在早于本轮的全量测试和构建进程，进程输出通道提前关闭，当前无法把这些进程的最终退出码可靠归属于本次修改。因此本记录不把它们标记为通过。

## 未验证边界

- 未连接真实 Gateway 验证 full `cron.list` 的 next-run read view。
- 未在 Windows、macOS、CentOS 或 Ubuntu 真机检查日历条和月视图渲染。
- 未验证长时间运行期间下一次调度更新时间的可见性。
