# OpenClaw 会话 Companion 控制台对齐

## 权威依据

- OpenClaw 官方 `docs/tools/btw.md` 将 Control UI 类客户端的 `/btw` 与 `/side` 定义为 `sessions.companion.*` 路径；该路径与外部渠道和 TUI 使用的 `chat.side_result` 一次性 BTW 合约不同。
- OpenClaw 官方 `docs/web/control-ui.md` 定义 Companion 为会话侧栏中的只读线程，可在当前会话运行时提问，不写入 `chat.history`。
- 官方 schema `packages/gateway-protocol/src/schema/sessions.ts` 定义 `sessions.companion.ask`、`state` 和 `reset` 的闭合参数与结果；问题上限 400 字符，回答上限 1200 字符，线程最多 24 条交换。
- 官方 handler `src/gateway/session-companion-rpc.ts` 说明 ask 和 state 需要 `operator.read`，reset 是 `operator.write` 控制面操作；`src/gateway/session-companion.ts` 说明线程只存在 Gateway 进程内，并会在会话 reset、Gateway restart 或空闲清理后消失。

## 原因与调整

JunQi 原有 `/btw` 实现调用普通 `chat.send`，等待 `chat.side_result`，并以本地 run 登记、Zustand 临时结果和聊天尾部卡片投影结果。该实现对应旧的一次性 BTW 传输契约，不是当前 OpenClaw 对 Control UI 类客户端给出的 Companion 语义。

本次删除旧的 `chat.side_result` 解析、run 登记、本地结果存储、尾部卡片及其专属测试。`ChatSendCoordinator` 和 Gateway `sendMessage` 恢复为仅处理普通 Chat/Steer，`/btw` 不再被客户端伪装成普通 Chat 发送。

## 当前行为

- 聊天上下文工具栏提供会话 Companion 入口，打开独立聊天侧栏，不依赖输入框中的普通发送路径。
- `/btw` 与 `/side` 由 Composer 在发送前识别，直接打开并预填该侧栏，不调用 `chat.send`。
- 侧栏仅以当前 `sessionKey` 调用 `sessions.companion.state`、`sessions.companion.ask` 和用户确认后的 `sessions.companion.reset`。请求使用当前 attested Gateway connection fence；连接变化、断线或未知方法均失败关闭。
- 回答仅保留在组件内存中，并可由 `state` 从 Gateway 当前进程内线程重新读取；不写入 JunQi store、localStorage、OpenClaw transcript、Task checkpoint 或发送队列。
- Gateway 的 `SESSION_COMPANION_BUSY` 明确显示为忙碌；其余未授权、不可用或无效响应不推断为已回答或已清空。
- UI 使用现有 `ChatSidePanel`、Aegis 主题 token、键盘 Escape 关闭与确认对话框。清空操作由 OpenClaw 官方 reset RPC 完成，主运行和聊天历史保持不变。

## 验证

- `pnpm exec tsc --noEmit`：通过。
- 定向 `node --import ./test-setup.ts --import tsx --test`：117 项通过，覆盖 Companion RPC 围栏、边界响应、忙碌映射、面板边界以及聊天发送、事件与 store 回归。
- `pnpm lint`、`pnpm test`（245 项）、`pnpm test:rust`（709 项）、`pnpm build`、`pnpm verify:openclaw-docs`、`cargo fmt -- --check`、`cargo check --lib` 与 `git diff --check`：通过。
- 尚未连接真实 Gateway，也未在 macOS、Windows、CentOS 或 Ubuntu 的实际桌面安装包中完成端到端验证。

## 非目标

- 不将 Companion 作为 Jarvis 语音、普通 Agent、Task、工具调用或会话恢复机制。
- 不重放、持久化或从冷启动恢复 Gateway 已清理的 Companion 线程。
- 不修改 OpenClaw 的 utility model、只读工具范围、限流、空闲过期或主 Run 语义。
