# 会话输入区原生交互审计

日期：2026-08-25

## 范围与依据

本次审计覆盖 `MessageInput`、`ComposerInputSurface`、发送事务、Gateway 分发、停止操作、会话投影、键盘操作和相关测试。目标是让 JunQi 的会话输入区忠实呈现 OpenClaw 已存在的发送、中断、队列和转向语义，不增加本地运行状态。

权威依据为 2026-08-25 更新后的 OpenClaw 官方主线 `610fefdabbce28584d5bec940936083b248550f0`：

- `packages/gateway-protocol/src/schema/logs-chat.ts` 定义 `chat.send.queueMode` 的 `steer`、`followup`、`collect` 和 `interrupt`。
- `docs/gateway/protocol.md` 说明 `sessions.steer` 已废弃，等价替代为 `chat.send` 携带 `queueMode: "interrupt"`；同时定义 `chat.abort`、`sessions.abort` 和活动运行期间的 `steer` 行为。
- `ui/src/pages/chat/components/chat-composer-controls.ts` 使用单一主操作位：有输入时发送、转向或排队，无输入且运行中时停止。
- `ui/src/pages/chat/components/chat-composer-keydown.ts` 定义 Enter 发送、Shift+Enter 换行、输入法保护、Escape 停止和修饰键强制转向。
- `ui/src/pages/chat/run-lifecycle.ts` 仅中止当前运行，不删除会话或转录；没有暂停后恢复同一次运行的协议。

当前项目安装版本和本机 Gateway 日志只用于解释历史实现，不作为目标能力门禁。此前运行时拒绝 `queueMode` 的证据不能覆盖最新版官方协议。

## 调用链

`ComposerInputSurface` 接收输入和按钮操作，`MessageInput` 组合发送与停止 Hook，`useMessageSend` 创建发送事务，`ChatSendCoordinator` 维持会话写入准入，`GatewayService.sendMessage` 最终调用 OpenClaw Gateway。停止操作由 `useComposerInterruption` 调用统一的 `gateway.abortChat`。

## 发现

### 严重：转向按钮调用已废弃且语义不同的入口

当前 `onSteer` 通过独立 `OpenClawSessionSteerClient` 调用 `sessions.steer`。最新版官方协议已将该入口标记为废弃别名，且其语义是中断活动运行后发送新消息，不是当前 UI 文案暗示的在原运行内调整方向。

影响：按钮名称、Gateway 调用和用户预期不一致；后续上游移除别名后该入口会直接失效。

### 严重：同一时刻出现多个竞争主操作

活动运行且输入框有内容时，界面同时显示发送、转向和停止三个同尺寸按钮。Enter 固定执行普通发送，鼠标又能选择另外两个动作，用户无法从布局判断默认行为，也无法稳定形成发送与停止的肌肉记忆。

影响：最常用操作的目标位置变化且语义冲突；窄窗口进一步压缩输入空间。

### 中等：客户端未投影 Gateway 的有效队列模式

官方会话行提供 `queueMode` 和 `effectiveQueueMode`，当前 `Session` 投影丢弃这两个字段。因此活动运行中普通发送实际会转向、排队、收集还是中断，由 Gateway 决定，但客户端无法给主按钮提供真实标签。

影响：即使调用成功，按钮也可能描述错误行为。

### 中等：空闲 Escape 修改草稿但没有对应的历史语义

输入框空闲时按 Escape 会把最近一条用户消息直接复制为草稿。该行为既不是 `sessions.rewind`，也不是 `sessions.fork`，并与已有的上下方向键历史浏览重复。

影响：Escape 同时承担取消菜单、停止运行和召回历史三个职责，状态难以预测；会话历史编辑的正式入口被弱化。

### 中等：停止无本地运行标识时可能保留待发队列

当前 Stop 始终省略 `clearQueued`。当客户端重连后只知道会话仍在运行、但没有精确本地 `runId` 时，停止活动运行后，已有后续消息可能再次启动运行。

影响：用户看到停止反馈后仍可能继续收到输出。最新版官方 Control UI 对非全局、按会话键停止的这一分支会清理队列。

### 低：旧实现的测试和文档会继续保护错误路径

专用 `sessions.steer` 客户端、测试和旧审计记录仍把历史运行时拒绝当作当前产品契约。

影响：后续维护会误以为废弃入口必须保留，并再次偏离最新版 OpenClaw。

## 修复决策

- 输入区只保留一个固定主操作位；空闲时为发送，活动运行无内容时为停止，活动运行有内容时按 Gateway 有效队列模式显示发送、转向、排队或中断并发送。
- 普通点击和 Enter 不强制覆盖 Gateway 队列策略；仅明确的修饰键转向操作发送 `queueMode: "steer"`。
- 删除 `sessions.steer` 专用路径，所有消息统一经 `chat.send`。
- Stop 只终止当前运行；精确 `runId` 中止保留队列，非全局会话的键级中止清理队列，绝不删除会话或转录。
- 删除空闲 Escape 的历史召回，保留已有上下方向键草稿历史和正式 rewind/fork 操作。

## 验证边界

自动化应覆盖主操作状态矩阵、队列字段投影、`chat.send` 参数、输入法与键盘决策、Stop 的精确运行和键级分支。真实 Tauri WebView 还需连续验证亮色、暗色、窄窗口、输入法、焦点、发送到运行、运行中输入、停止和失败反馈；未完成前不得宣称真机交互已验收。

## 实施与验证结果

- Composer 已收敛为一个固定主操作位，空闲、发送、转向、后续队列、中断并发送和停止共用同一位置。
- Enter、Shift+Enter、输入法组合和活动运行中的 Ctrl+Enter 或 Command+Enter 已由纯决策回归覆盖。
- 会话投影只接受四种官方队列模式；未知值保持未知，普通发送不携带客户端覆盖。
- 显式转向已统一为 `chat.send queueMode: "steer"`，旧专用客户端、测试和历史运行时门禁文档已删除。
- Stop 的精确运行与键级清队列分支已覆盖，失败会在 Composer 内联显示，不再只写调试日志。
- 最终定向测试 31 项、完整前端测试 2941 项、脚本测试 238 项通过；`pnpm lint`、`pnpm build` 和 `git diff --check` 通过。
- 已在真实 Tauri 调试窗口验证浅色主题的标准宽度和 900 像素窄窗口；输入区没有横向溢出，主操作位可见且位置稳定。
- 未向真实 Gateway 发送验证消息，因此活动运行中的转向、排队、中断和停止连续状态仍未真机核验。暗色主题自动截图没有成功，应用保持原浅色主题，该项仍标记为未验证。

## 已发送消息操作栏修正

用户消息操作栏原先同时用 `GitFork` 表示 OpenClaw 会话分叉和 JunQi 多 Agent 协作入口。两者协议语义不同，却显示为连续的两个相同图标；仅靠 tooltip 和辅助名称无法让鼠标用户在操作前区分。

修正后，会话分叉继续使用原图标并保持 OpenClaw `sessions.fork` 语义；多 Agent 协作改用带可见本地化名称的成员图标按钮，并通过 `aegis-border` 与普通消息操作分组。按钮复用现有 `aegis-primary`、焦点环、禁用态和加载指示器，粗指针环境提高最小触控高度，窄窗口继续允许操作栏换行。该改动只调整入口表达，不改变协作插件或 OpenClaw 协议。

组件回归已覆盖待启动、查看运行和消息身份确认三种状态，并断言协作入口不再使用会话分叉图标。真实 Tauri 的亮色、暗色、窄窗口、悬停和键盘焦点视觉仍需随本地测试包确认。
