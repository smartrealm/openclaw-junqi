# OpenClaw 桌面语音与 Jarvis 边界审计

日期：2026-08-05

## 权威依据

本次直接核对 OpenClaw 官方工作树 `/Users/wei/DevTool/project/mine/gui/Openclaw` 的文档、协议 schema、Gateway handler 与 Talk 运行时。审计时官方源码为 `1e3880352e614116549c0a30c67a59a2d40ba259`。该提交只用于复现本次结论，不是 JunQi 的版本锁；运行时仍以 Gateway 实际广告和严格响应解码为准。

- `docs/nodes/voicewake.md` 定义 `voicewake.get`、`voicewake.set`、`voicewake.routing.get`、`voicewake.routing.set` 以及相应变更事件。路由目标只能是当前上下文、`agentId` 或 `sessionKey`。
- 同一文档只声明 macOS、iOS 和 Android 客户端的本地 Voice Wake 行为。它没有给 Windows、CentOS 或 Ubuntu 桌面客户端定义统一的后台关键词检测器。
- `docs/nodes/talk.md`、Gateway Talk schema、handler 与官方 Control UI 定义 `talk.catalog`、`talk.session.create`、`appendAudio`、`cancelOutput`、`cancelTurn`、`close` 和 `talk.event`。
- `ui/src/pages/chat/realtime-talk-gateway-relay.ts`、`src/gateway/server-methods/talk-client.ts`、`talk-session.ts` 与 `agent-wait.ts` 证明 `gateway-relay` 的客户端还必须处理官方 `openclaw_agent_consult`、`openclaw_agent_control`，并通过 `talk.client.toolCall`、`agent.wait`、`talk.session.steer`、`talk.session.submitToolResult` 和精确 `chat.abort` 完成中继闭环。
- `src/gateway/talk-realtime-relay-session-create.ts` 与官方 Control UI 证明 `clear` 要立即停止本地播放，`mark` 只能在对应音频播放排空后通过 `talk.session.acknowledgeMark` 精确确认。
- `packages/gateway-protocol/src/schema/logs-chat.ts`、`src/gateway/server-methods/chat-send-handler.ts` 与 Control UI 发送实现证明运行中消息的 `steer`、`followup`、`collect`、`interrupt` 选择属于 Gateway；客户端普通发送不得另设默认队列模式。
- `packages/gateway-protocol/src/schema/sessions.ts` 与 `src/gateway/server-methods/sessions-groups.ts` 定义通用会话组目录；Voice Wake 路由没有自动创建或分配会话组的协议。

## 审计结论

JunQi 可以作为 OpenClaw 的桌面 Talk 客户端，也可以编辑 Gateway 拥有的 Voice Wake 触发词与路由。JunQi 不能把自有关键词模型、登录自启或后台麦克风 worker 描述成 OpenClaw 的跨平台常驻唤醒能力。因此删除 Sherpa、本地 `wake_word`、唤醒后自动分类、待机绑定与相关旧界面。

当前 Jarvis 模式是用户主动开启的 Talk 工作区，不是伪造的二十四小时唤醒服务。它只在已连接 Gateway、已选择真实 OpenClaw session，并且 `talk.catalog` 广告可用的 `realtime`、`gateway-relay`、`agent-consult` 与兼容 PCM 格式后启动。

## 运行链路

1. 设置页独立读取和写入 Gateway 的触发词与路由，不申请麦克风，也不自动启动 Talk。
2. 用户从桌面会话操作区启动 Jarvis。根运行时绑定当前 `sessionKey` 与已验证连接，创建 Gateway-owned Talk session。该 Talk 生命周期内的创建、音频、控制、工具结果、中止和关闭请求全部固定到创建时的连接租约；Gateway 重连后，旧租约请求必须失败，不能借新连接操作旧 session 或 run。
3. Tauri Rust 端通过 CPAL 采集 Gateway 返回格式对应的 PCM；CPAL 0.15 声明的整数、无符号整数和浮点样本格式统一转换为 PCM16。前端只转发有所有权的帧，并把原生 RMS 用于真实音量表。并发追加最多四个，单次请求八秒超时，停止或连接切换会通过 `AbortSignal` 取消待处理请求。
4. `talk.event` 驱动听取、识别、思考和播放状态。输出格式来自已确认的 Talk session，Rust 端通过 Rodio 播放并限制队列时长、单帧大小和总缓存。中继外层身份必须与规范事件的 session、turn、call 和 mark 身份一致，畸形事件使当前 Talk 明确失败。
5. provider `clear` 到达时立即停止旧音频并隔离被取消 turn 的迟到文本和音频；provider `mark` 只有在原生播放实际排空后才调用 `talk.session.acknowledgeMark`，不能以网络事件到达代替播放完成。
6. 用户开口打断播放时调用官方 `talk.session.cancelOutput`，原因是 `barge-in`；本地播放队列溢出时使用官方 `playback-overflow`。旧 session、旧 turn 和旧连接的事件不会改变当前界面。
7. provider 发起 `openclaw_agent_consult` 时，JunQi 只以官方返回的 `runId` 等待和中止该 run；`openclaw_agent_control` 只转发到官方 steer handler。最终结果在本地语音播放排空后通过 `talk.session.submitToolResult` 交回 provider，未知工具也只返回 Talk 中继错误，不执行客户端自定义工具。
8. 用户停止 Jarvis 时先释放麦克风和本地播放，再调用 `talk.session.cancelTurn` 与 `talk.session.close`。原生采集只有收到 worker 退出确认后才返回已停止并发出停止事件；超时必须显式失败，不能把仍可能占用设备的状态报告为成功。关闭的是本次 Talk 传输和当前 run，不清空绑定的 OpenClaw session 或其历史；仍在执行的 consult 使用其精确 `runId` 调用 `chat.abort`。

OpenClaw Gateway 负责 ReAct 运行、聊天工具调用闭合、会话快照与恢复。JunQi 不合成聊天历史中的 recovery `tool_result`，不修改半截 ReAct 工具链，也不在客户端复制任务图。`talk.session.submitToolResult` 是官方实时语音 provider 的客户端中继协议，不是向聊天历史伪造 Tool 消息。普通聊天停止继续使用 OpenClaw 原生中止能力，并保留同一 session 的历史；语音模式只调用 Talk 协议和精确 run 中止协议拥有的方法。

普通聊天发送不传入客户端猜测的队列模式，由 `chat.send` 应用 Gateway 当前会话配置。只有用户明确执行转向时才调用官方 `sessions.steer`。JunQi 的本地可见队列只在会话重置、删除等破坏性变更的交接窗口暂存尚未交给 Gateway 的消息；一旦交接给 Gateway，发送确认、运行中队列和 Stop 都以官方身份与事件为准。旧 Jarvis 聊天来源不再产生；已有本地任务快照在读取时迁移为普通聊天来源，不创建新的 OpenClaw 语义。

## 桌面交互

- Talk 激活后，全窗口遮罩位于普通应用弹窗、菜单和通知之上，覆盖整个主窗口并展示当前会话、用户转写、助手文本、阶段、停止和失败重试。焦点被限制在遮罩内，`Escape` 与停止按钮执行同一释放流程；致命错误层仍保留最高诊断权限。
- 输入框只保留明确的手动录音与 Jarvis 启动命令，不承载触发词和路由配置。
- 主窗口可见时不重复展示灵动岛。主窗口最小化且语音活动仍存在时，灵动岛只显示非敏感阶段与返回主窗口提示，不显示转写正文。
- 萌宠只接收听取、识别和思考等非文本状态，不持有麦克风、Gateway session 或转写内容。
- 灵动岛预览有确定的自动关闭计时；关闭操作同时请求原生窗口隐藏并发送主窗口意图，异步打开结果不能覆盖更新的隐藏意图。

## 跨平台边界

CPAL 与 Rodio 的实现避免依赖 Web Speech、`MediaRecorder` 或 WebView 麦克风接口，代码可面向 Tauri 支持的 Windows、macOS 和 Linux 目标编译。设备初始化、停止确认和最长九十秒的播放排空都在 Tauri 阻塞任务池执行；音频 worker 停止等待有明确上限，未在上限内确认退出时返回错误并让所有权围栏拒绝迟到事件。设备枚举、独占音频、权限、休眠恢复和驱动差异仍必须分别做真机验证。CentOS 的具体桌面、WebKitGTK、音频服务和发行版版本未知时不得声称可用；失败必须明确呈现，不能切换到其他运行时或伪造成功。

## 验证边界

自动化验证覆盖严格协议解码、连接围栏、事件顺序、音频背压、中断、停止、Gateway 队列权威、本地交接队列上限、界面投影和 IPC 注册。真实 Gateway、真实麦克风与扬声器，以及 Windows、Ubuntu、CentOS 目标机验证会在执行后按实际结果记录；未执行的项目不视为通过。

## 实际验证

- Talk Gateway client 与协调器的 30 项定向测试通过；发送队列、任务快照迁移和全窗口音量投影由相应领域回归覆盖。
- `pnpm lint` 通过：模块边界检查覆盖 886 个文件，桌面版本在四个来源中一致，TypeScript 无类型错误。
- `pnpm test` 通过：前端与领域测试 2772 项、脚本测试 246 项，均无失败。
- `cargo fmt -- --check`、`cargo check --lib` 与 `pnpm test:rust` 通过；Rust library 测试 711 项通过、2 项按既有条件忽略。
- `pnpm collab:test` 通过 368 项测试；`pnpm collab:validate` 通过插件构建和包契约验证。
- `pnpm build` 通过，协作插件 bundle 重新生成并验证，Vite 生产构建完成 9220 个模块转换。
- `pnpm verify:openclaw-docs` 通过；修改文件全文 Emoji、Jarvis 三语言键、废弃引用、桌面语音浏览器 API、IPC 注册、仓库内 Markdown 链接和 `git diff --check` 均通过静态检查。
- `pnpm tauri dev --no-watch` 完成原生桌面二进制编译并启动 Tauri 窗口，稳定运行五秒后正常停止；该步骤没有使用浏览器作为产品运行时。

## 未验证边界

- 未连接真实 OpenClaw Gateway 执行 Talk provider、实时音频、`clear`、`mark`、consult 和 tool relay 的端到端验收。
- 未使用真实麦克风或扬声器验证 macOS 权限、设备切换、独占模式、休眠恢复和驱动异常。
- 未在 Windows、Ubuntu 或 CentOS 真机验证采集、播放、权限、安装器或系统音频服务；当前结论只证明共享代码、协议检查和本机 macOS 编译启动通过。
- 未执行正式签名、公证、安装包构建、Release 或线上部署。
