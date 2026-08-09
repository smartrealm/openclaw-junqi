# OpenClaw 桌面语音与 Jarvis 边界规格

## 目标

JunQi 只实现 OpenClaw 官方已定义的 Voice Wake 配置与 Talk 客户端协议，并提供清晰、可中断、资源有界的桌面交互。不得把客户端增强描述成 Gateway 原生能力。

## 协议约束

1. 触发词使用 `voicewake.get`、`voicewake.set` 与 `voicewake.changed`；路由使用 `voicewake.routing.get`、`voicewake.routing.set` 与 `voicewake.routing.changed`。
2. Voice Wake 路由目标只接受官方的当前上下文、`agentId` 或 `sessionKey`。不得自动创建会话、修改 category 或生成客户端 group。
3. Jarvis Talk 只能在 `talk.catalog` 明确广告兼容的 `realtime`、`gateway-relay`、`agent-consult`、barge-in 和 PCM 格式后创建。
4. 音频输入输出格式以 `talk.session.create` 的确认响应为准。整个 Talk 生命周期固定到创建时的 Gateway 连接租约；格式不匹配、目录未就绪、响应畸形或连接切换均失败关闭，旧 session、run 或工具调用不得经新连接继续发送。
5. `talk.catalog.realtime.ready` 为 `false`、目录结构无效或没有满足原生 PCM、`gateway-relay`、`agent-consult`、barge-in 和工具调用能力的提供方时，客户端必须分别呈现真实失败原因，不得进入采集或伪造可用状态。
6. `gateway-relay` 只执行 Gateway 发出的官方 `openclaw_agent_consult` 和 `openclaw_agent_control`。consult 必须使用 `talk.client.toolCall` 返回的精确 `runId` 调用 `agent.wait` 或 `chat.abort`，provider 结果只能通过 `talk.session.submitToolResult` 提交。
7. 中继外层事件必须与规范 `talk.event` 的 session、turn、call 和 mark 身份交叉核对。`clear` 立即清空本地输出并隔离迟到事件；`mark` 仅在原生播放排空后通过 `talk.session.acknowledgeMark` 确认。
8. 停止使用 `talk.session.cancelTurn` 与 `talk.session.close`，打断使用 `talk.session.cancelOutput`。不得清空 OpenClaw session，也不得由客户端合成聊天 recovery 工具结果或修复 ReAct 历史；官方 Talk provider 中继结果不属于聊天历史修复。
9. 普通消息由 `chat.send` 使用 Gateway 当前队列模式；只有明确转向使用官方 `sessions.steer`。客户端不得为运行中会话设置猜测性默认队列模式，本地队列只保护破坏性会话变更期间尚未交接的消息。

## 资源与并发约束

1. 麦克风采集和扬声器播放只能由 Tauri 原生边界拥有，不使用 Web Speech、`MediaRecorder` 或 WebView 麦克风接口。设备阻塞操作不得占用 Tauri 调度线程。
2. Talk 音频追加有并发上限、请求超时和可取消信号；停止、目标变化或连接变化必须使旧请求和旧事件失效。
3. 原生采集缓存、worker 停止等待、播放单帧、播放队列总字节和估算时长均有上限。CPAL 当前声明的样本格式必须统一转换，不能只按开发机默认格式实现。worker 未在上限内确认退出时必须返回失败，不能发出已停止事件或返回伪成功；溢出不得无限积压或静默丢失当前所有权。
4. 同一时间只有一个桌面 Talk 所有者。切换 session 时先关闭旧 Talk session，再为新目标创建会话。
5. provider `mark` 的确认等待必须与对应 session 的原生播放生命周期绑定；停止、`clear`、session 替换或失败必须解除等待，不能留下永久任务或向错误 session 确认。

## UI 约束

1. Talk 激活时使用全窗口遮罩，不局限在输入框；遮罩位于普通应用弹窗、菜单和通知之上，并支持停止、重试、键盘焦点闭环和 `Escape`。音量反馈必须来自原生采集 RMS，不能使用伪波形数据。
2. 设置入口位于独立 Jarvis 设置页，只编辑 Gateway 拥有的触发词和路由，不启动麦克风。
3. 主窗口可见时灵动岛不与全窗口遮罩重复；主窗口最小化时仅投影非敏感阶段，不展示转写文本。
4. 萌宠只消费非文本阶段，不拥有音频、连接或 session 生命周期。
5. 所有用户文案通过国际化资源提供；运行诊断不能代替本地化错误状态。

## 清理与兼容约束

1. 删除 Sherpa、本地 `wake_word`、后台待机、自启绑定、自动会话分类、旧 Jarvis 聊天来源及其无引用命令、依赖、状态、文案、测试和文档；既有本地快照只做明确迁移，不保留新的运行入口。
2. 平台路径、设备、采样格式、Gateway 地址、agent、session、provider 和能力状态不得从当前开发机硬编码。
3. Windows、macOS 和 Linux 共用同一契约与 Tauri IPC；平台真机未验证时必须明确记录，不得推断成功。

## 验收条件

- 严格解码 Voice Wake、routing、Talk catalog、Talk session 与 `talk.event`。
- 回归覆盖启动、连接租约切换、旧请求拒绝、事件乱序、barge-in、播放溢出、停止未确认和重复释放。
- 回归覆盖 `clear` 即时停止、迟到 turn 围栏、播放排空后的精确 mark 确认，以及普通发送服从 Gateway 队列权威。
- Tauri command 名称、参数、返回字段及 Rust 注册完全一致。
- 相关 TypeScript、Rust、插件、构建、文档链接、无引用和 Emoji 检查通过。
