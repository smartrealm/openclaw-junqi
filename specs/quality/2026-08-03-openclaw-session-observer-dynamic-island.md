# OpenClaw Session Observer 灵动岛规格

日期：2026-08-03

## 目标

在用户明确允许时，让灵动岛呈现最新版 OpenClaw Gateway 的原生 `session.observer` 摘要，而不创造
新的 Agent 或任务状态。

## 约束

1. 仅在 `sessions.observer.visibility` 被当前连接广告且存在已认证 connection fence 时请求可见性。
2. 可见性只在灵动岛启用、Observer 开关启用、主窗口最小化且 Gateway 已连接时为 true；其他状态为 false。
3. event 必须严格验证 session identity、revision、时间、headline、health 和可选字段；未知或陈旧 event 不得投影。
4. 摘要只能保存在进程内，并且只投影 headline、health、session/agent identity；不得写入 transcript、Task、checkpoint 或宠物状态。
5. `done` 与 `failed` Observer digest 不得使灵动岛持续显示；仅新出现的 `stuck` 或 `waiting-on-user` 可以触发已有的自动展开策略。
6. 不调用 branch、restore、abort、工具、模型或任何非 visibility 的 Observer RPC。

## 验收条件

- 能力广告、连接围栏、可见性切换和迟到请求均有回归测试。
- 无效、陈旧、跨 Agent 或结束的 digest 不会制造活动态；有效活动 digest 能在灵动岛展示其原生 headline 与 health。
- 三个语言目录覆盖设置与 health 文案，禁用或断线后不会显示缓存摘要。

## 本次验证

- 定向回归、`pnpm lint`、完整 `pnpm test`、`pnpm verify:openclaw-docs` 与 `pnpm build` 已通过。
- 真实 Gateway 和各桌面目标平台仍按对齐记录中的未验证边界处理。
