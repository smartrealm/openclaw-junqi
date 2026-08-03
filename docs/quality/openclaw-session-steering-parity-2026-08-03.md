# OpenClaw 会话 Steering 能力对齐

日期：2026-08-03

## 依据

OpenClaw 官方 Gateway 协议将 `sessions.steer` 定义为活动会话的
interrupt-and-steer 变体；`chat.send` 的 `queueMode: "steer"` 则是一次性的队列
覆盖。两者不能混用：前者替换活动运行，后者在运行时可接受时于模型边界注入输入。
本机安装包只用于复现和记录验证范围，不作为字段或能力的长期契约。

官方文档同时区分两种行为：普通消息默认使用队列 `steer`，在模型边界注入而不
中断正在执行的工具；显式 `sessions.steer` 是 interrupt-and-steer，用于当前
输入必须立即替换活动运行的场景。

## 历史问题

早期 JunQi 的普通发送会在会话忙时进入可见消息队列，停止按钮只调用
`chat.abort`。因此用户无法在保留新指令的同时，以 OpenClaw 的官方
interrupt-and-steer 语义重新启动同一会话。

## 修复行为

- `src/services/gateway/OpenClawSessionSteerClient.ts` 严格构造官方参数，拒绝空
  会话、空消息和非法超时，不添加 OpenClaw 未声明的字段。
- `src/services/gateway/index.ts` 经由受限的 `OpenClawSessionSteerClient` 调用
  `sessions.steer`，保留 idempotency、发送不确定性和运行状态对账路径。
- Chat 输入在当前会话有活动运行且草稿非空时显示独立 steering 图标。普通发送
  直接交给 Gateway 的当前 queue mode；steering 只在用户明确点击该图标时中断并
  发送，不改变默认行为。
- 维护操作进行期间 steering 不绕过会话 mutation gate。

## 2026-08-04 清理复核

`sessionSteering.ts` 与其专属测试已无生产调用方；同一职责已由
`OpenClawSessionSteerClient` 唯一承载。全局引用图覆盖静态导入、动态导入、Gateway
门面、测试和文档后确认不存在其他消费者，因此一并删除，避免两个参数构造器随上游
协议漂移。

## 验证

- `OpenClawSessionSteerClient` 参数与响应测试覆盖字段、空值、超时、idempotency
  key 和无效确认响应。
- ChatSendCoordinator 回归测试确认活动会话 steering 不进入本地队列，并调用
  interrupt-and-steer 端口。
- Composer 结构测试确认 steering 图标、可访问名称和三种 locale 文案存在。
- 2026-08-04 执行引用扫描、相关定向测试、`pnpm lint` 与 `git diff --check`。

真实 Gateway 上的活动工具中断、不同 Agent runtime 对 steering 的接受边界仍需在
隔离 Gateway 上验收；自动化测试不把 mock 响应当作真实运行时证据。
