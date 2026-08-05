# OpenClaw Composer 队列权威与灵动岛预览可见性审计

日期：2026-08-03

## 结论

JunQi 是 OpenClaw 的桌面客户端。普通 Chat 输入在 Session 已有活动 Run 时必须照常
进入 Gateway；OpenClaw 决定该输入按 `steer`、`followup`、`collect` 或 `interrupt`
处理，并为 admitted queued turn 保留可授权的取消身份。JunQi 不得依据本地 typing
投影替代 Gateway queue authority。

灵动岛是 JunQi 的辅助桌面窗口，不属于 OpenClaw 协议。其预览仍必须经由
`DynamicIslandRuntime` 的单一可见性状态管理，避免 Settings 直接打开窗口后失去收起
条件。

## 权威依据

- [OpenClaw command queue](https://docs.openclaw.ai/queue)
- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol)
- [OpenClaw chat handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/chat.ts)
- [OpenClaw queued turn registry](https://github.com/openclaw/openclaw/blob/main/src/gateway/chat-queued-turns.ts)

安装版 OpenClaw `2026.7.1-2` 的 `chat.send` handler 将 `idempotencyKey` 作为 client
run identity；followup/collect admission 后为该 identity 注册 Gateway-owned queued-turn
取消记录。官方 queue 文档规定普通中途输入由 Gateway 的 per-session lane 和 queue mode
处理，客户端不应在本地猜测是否应进入 followup。

## 发现

### CQ-01 - 高 - Composer 将普通输入错误强制进入本地队列

位置：`src/components/Chat/message-input/useMessageSend.ts`

`ChatSendCoordinator` 已正确定义：只有调用方显式要求本地 queue，或
`sessionMutationGate` 阻塞时，renderer 才拥有一个本地可编辑队列；否则即使
`typingBySession` 为真也会把消息和既有 `clientMessageId` 转发到 Gateway。

但 Composer 对所有 normal delivery 固定传入 `queueIfBusy: true`。因此活动 Run 中的
普通输入永远不会到达 Gateway，`/queue` 设置、same-turn steering、followup/collect
合并、overflow 策略和 Gateway queued-turn cancel identity 均被绕过。该本地队列也不具备
Gateway 的跨客户端或冷启动权威。

修复是让 normal delivery 省略该 opt-in；steer、本地明确 queue 与会话 mutation 的原有
边界不变。

### DI-02 - 高 - 灵动岛预览绕过主窗口可见性所有权

位置：`src/pages/SettingsPage.tsx`、`src/dynamic-island/DynamicIslandRuntime.tsx`

Settings 的预览按钮直接调用 `open_dynamic_island`。运行时的 `shouldShow` 未因这次动作
变化，因此没有一个受控状态会在预览结束或关闭时调用 `close_dynamic_island`。当窗口处于
空闲快照时，这正是“预览后一直不消失”的条件。

修复必须把 Settings 行为改为预览 intent，并由 runtime 管理短暂 preview state、窗口开启、
自动收起和用户关闭；不能仅在 Settings 加一个未关联的 close timer。

## 修复与定向验证

修复后，普通 Composer 保留其 idempotency key 并直接调用 Gateway。JunQi 本地队列仍是
显式、可见、可编辑的未提交输入，不被误称为 OpenClaw queued turn。灵动岛预览只属于
主窗口 runtime 的临时展示状态，结束后不改变用户偏好。

普通 Composer 现在只在用户选择 `steer` 时传入 delivery 选项。正常发送保留既有
`clientMessageId`，不再要求 renderer 在 Session 忙碌时自行排队，因此会交由 Gateway
按当前原生 queue mode 接收。

Settings 现在只发出 `dynamic-island:preview` intent。`DynamicIslandRuntime` 通过一个
5.4 秒的本地预览生命周期拥有窗口可见性；重复预览重置时限，辅助窗口的 Hide 动作只会
结束预览，常规 Hide 保留原有的关闭功能语义。

已通过以下定向验证：

- Composer normal/steer delivery 回归。
- `ChatSendCoordinator` 的 Gateway authority、显式 local queue、session mutation
  栅栏和 queue overflow 回归。
- 灵动岛 preview 生命周期、显示模型和 Tauri integration 回归。
- `pnpm lint`，包括 TypeScript 和模块边界检查。

完整验证结果：

- `pnpm test`：通过。
- `pnpm lint`：通过。
- `pnpm build`：通过。
- `pnpm verify:openclaw-docs`：通过。
- `pnpm collab:test` 与 `pnpm collab:validate`：通过。
- `pnpm test:rust`：703 通过，3 个既有忽略。
- `cargo fmt -- --check` 与 `cargo check --lib`：通过。
- `git diff --check`：通过。

## 未验证边界

- 未在真实 Gateway 验证每一种 queue mode、跨客户端 queued-turn 所有权和精确 abort
  时间线。
- 未在 Windows、CentOS、Ubuntu 或 macOS 真机验证灵动岛预览的辅助窗口自动收起和焦点。
