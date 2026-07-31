# 语音唤醒与 Jarvis 式工作台设计及业务闭环审计

日期：2026-07-31

状态：审计提案与部分实现记录。本文件不把自动化测试或源码静态检查表述为真实设备、真实 Gateway 或正式发布验证。

## 1. 结论

JunQi 已有可复用的语音播放、聊天附件、Dynamic Island、萌宠状态投影和协作写入门禁；这些能力可以组成一条长期可维护的桌面语音路径。但当前实现尚不能作为“语音唤醒”发布：浏览器路径是连续听写，Rust 路径是能量 VAD 占位，二者都没有真实关键词识别。

建议的产品方向是：Gateway 继续拥有触发词和目标路由的权威配置；桌面端用本地关键词检测和 VAD 管理麦克风；所有结果仍通过既有普通聊天消息和 OpenClaw 音频理解链路进入会话；协作 Run、模板实例化、批准、取消和删除始终保留显式 UI 确认。不要让语音层直接调用 `junqi.collab.*`，也不要让宠物或 Dynamic Island 占用麦克风。

首个可交付版本只承诺“应用正在运行时的前台/最小化唤醒词 + 草稿确认发送 + 语音状态工作台”。它不承诺操作系统级常驻助手、锁屏唤醒、离线完整 ASR、自动执行协作命令或未经验证的实时 Talk。这样可先建立可靠状态机和实际设备证据，再扩大能力边界。

## 2. 审计范围与证据口径

本次读取的版本契约为桌面应用 `1.4.21`、锁定的 OpenClaw `2026.7.1` 与协作包 `0.4.0/schema 13`。源码和本地文档是当前行为依据；OpenClaw 上游 `v2026.7.1` 文档仅用于该安装版本的外部协议依据。

审计开始时本机没有 `node_modules`，当时没有重新运行 TypeScript、Rust、插件或打包测试。后续实现的本机自动化证据和仍未执行的真实验收见第 10 节；两者均不等同于真机或正式发布验证。

| 领域 | 当前实现与证据 | 审计判断 |
| --- | --- | --- |
| 应用入口 | `src/main.tsx` 按窗口 label 选择主窗口、宠物、Dynamic Island、Quick Chat 与终端根；`App.tsx` 挂载 Gateway、宠物和岛运行时。 | 入口分层清楚，但不同窗口的状态同步需要明确 ready 与可见性协议。 |
| 普通聊天 | `useComposerVoice.ts` 最终走 `chatSendCoordinator.send`，音频以普通附件进入当前会话。 | 是语音输入的正确业务入口；不应新增绕过它的 AI/协作入口。 |
| 语音 | `useVoiceWake.ts` 使用 Web Speech 连续听写或 `voice_wake` native 事件；`voice_wake.rs` 明确标注为 VAD placeholder。 | 生命周期防抖和陈旧回调保护已有基础，但不存在真实唤醒词引擎，且两条输入路径的发送语义不同。 |
| Dynamic Island | `DynamicIslandRuntime.tsx` 将聊天、任务、专注和语音状态投影给独立 WebView；模型和集成测试覆盖优先级与窗口契约。 | 架构方向正确，仍有原生关闭竞争和真实窗口交互验证缺口。 |
| 萌宠 | `usePetStateEmitter.ts` 在主窗口派生 `PetState`，宠物窗口只渲染；状态和背景采样有纯逻辑与源码回归测试。 | 主从边界清楚，但存在偏好同步、可见性和首次打开恢复缺口。 |
| 协作 | 前端写入需持久消息、session、runtime 和 instance identity 一致；插件端重新读取 origin 并在批准前保持 `AWAITING_APPROVAL`。 | 关键写入门禁较严，但当前制品缺少同版本真实 Gateway/Desktop 发布证据，且存在较大的维护单体。 |

## 3. 当前闭环审计

### 3.1 入口、运行时与工作流

1. `ensure_gateway_running` 的 Docker 快路径只确认容器在运行和 `/healthz` 可用，没有像正常 Docker 启动路径那样核对 Docker 配置、token 和 RPC 身份。若端口被不同配置的健康 Gateway 占用，系统可能把错误的运行时报告为可用。这违反“健康不等于身份、配置和授权正确”的既有边界。应在语音功能之前把 Docker 快路径改为同一份 `gateway_matches_config` 级别的身份验证，并增加配置不匹配的回归用例。
2. `AgentRunRoute` 在同一组件实例内从 task A 跳到 task B 时没有以 task id 重新挂载；内部 `taskId` 和每次 render 读取的 `workspaceTaskId` 可以分离。这会使 PTY/状态事件从 A 影响 B 的 store。语音工作台不得在这个不稳定路由上注册任务或目标会话动作，先修复 task identity 生命周期并添加 A/B 切换回归。
3. 通知、Timeline、Activity Center 和 Dynamic Island 存在指向 `/ai-workspace?task=...` 的任务深链，但该页面当前不消费 task query 或恢复对应 provider session；确切的持久任务恢复路径是 `/agent-run?taskId=...`。在工作台完成完整恢复前，应把这些入口统一到 canonical route，并覆盖每个入口的导航闭环。
4. Agent PTY 的取消和完成只终止直接 child，没有使用进程组或 Windows Job 等任务树终止语义。子进程可能在 UI 已显示 cancelled 后继续执行或写文件。语音不可提供“停止任务”一类承诺，直至以平台受控进程树、终止确认和子进程持续写入的回归测试修复该语义。
5. 路由树没有未知 URL fallback，陈旧通知链接或手工 URL 没有明确恢复路径。为语音目标、Dynamic Island focus 或任务通知新增 route 前，应先增加 catch-all recovery route 和测试。
6. Native 与 Docker 是用户持久化选择。语音启动、设备探测、Gateway 配置读取和故障恢复必须绑定当前选择的运行时；连接失败时显示 unavailable，不能默默切换到另一运行时或创建另一套本地语音配置。

### 3.2 协作业务闭环

协作的普通路径已形成合理的防线：Chat 侧要求持久 `nativeMessageId`、当前 session、durable runtime、实例 ID 和 feature contract；插件侧拒绝非用户 origin，并在模板实例化后重新进入批准状态。语音接入必须保持这条路径：它只能产出普通聊天草稿，用户确认发送后才有持久用户消息；用户再显式点击现有协作入口，才允许创建 Run 或模板实例。

仍需处理以下风险：

1. 当前嵌入制品是 `0.4.0/schema 13`，历史实施/发布证据仍绑定旧 bundle、旧 schema 或不同 hash。现有记录也列出真实 Gateway producer、视觉 QA、session reset/delete、Desktop 重连和 24 小时 soak 尚未完成。因此不能把当前协作版本称为真实运行时闭环已验证。
2. `CONTEXT.md` 定义 Workflow Template 的不可变版本语义，但公共实现只能创建 version 1 template，未提供新版本或归档生命周期。应在产品规格中明确 v1-only 范围，或新增版本发布/归档流程和迁移测试。
3. template `parameters` 当前被持久化和摘要计算，但未被 Desktop 传入或用于 plan materialization。它应明确为审计元数据，或补齐用户输入、解析、校验和可追溯 handoff；不能保持名称像可执行参数而实际无效。
4. `packages/junqi-collab/src/service.ts` 约 10,212 行，`src-tauri/src/commands/collaboration_bootstrap.rs` 约 8,605 行。现有拆分计划只完成一小部分 DTO 合同提取。它们不是已证实的行为错误，但会放大审核、回归和运行时变更风险，应继续按既有 FCA-14 和 bootstrap 分解计划拆分，不能在语音功能中混入大重构。

语音不得成为批准信号。误唤醒、转写、模型回复、动态岛动作和萌宠动作都不能自动 approve、cancel、delete、maintenance、session reset 或执行 Agent assignment。音频、转写和本地 partial 也不得写入协作 SQLite、协作事件、导出、bootstrap 日志或 RPC 控制字段。

### 3.3 Dynamic Island 与萌宠

现有设计的优点是正确的：主窗口保有业务 store，独立窗口只消费投影，宠物背景采样只传统计读数而不传桌面图像，语音播放已有跨窗口 claim/release/stop 协议。以下问题需要在把语音状态扩大到这些窗口前修复。

| ID | 严重性 | 发现 | 需要的修复与验证 |
| --- | --- | --- | --- |
| DI-01 | 中 | `close_dynamic_island` 在等待收起动画时，`set_dynamic_island_expanded` 可绕过同一 lifecycle gate 增加 generation；close 直接返回而不 hide，岛可能在状态结束后继续显示。 | 收起操作要有关闭优先的期望可见性，或将展开、重定位和关闭放入同一 lifecycle gate；增加并发 close/expand 真实窗口测试。 |
| PET-01 | 中 | 设置页只更新主窗口 `petStore`，已打开宠物 WebView 没有收到 caption scale 和 backdrop contrast 的实时更新。 | 将展示偏好放入 `pet-state` 投影，或建立严格类型化的 `pet-preferences` 跨窗口事件；验证已打开窗口立即更新。 |
| PET-02 | 中 | 宠物设置写入 `petStore.soundEnabled`，拖放和吞咽音效却读取全局 `settingsStore.soundEnabled`。 | 选择一个权威设置并移除另一份歧义状态；在主窗口和宠物窗口均验证切换后立即生效。 |
| PET-03 | 中 | 托盘直接 hide/show 宠物窗口，不发 `pet-visibility`，设置页缓存会反向。 | 托盘复用 `toggle_pet_window` 或同一可见性 authority；加托盘和设置页往返用例。 |
| PET-04 | 中 | 首次 `open_pet_window` 失败后模块级 `petWindowOpened` 保持 true，effect 不会自动重试。 | 只有创建成功后置位，失败后回退并呈现可重试状态；覆盖第一次失败、第二次成功。 |
| PET-05 | 低 | 打开后主窗口可能先发 `pet-state`，宠物监听尚未建立，首个快照会丢失。 | 复用 Dynamic Island 的 `ready` 补发模式；验证首次打开的静态状态可见。 |
| PET-06 | 低 | `PetBreakOverlay.tsx` 存在 `U+2728` 象形字符，违反仓库的全局 emoji 禁止规则。 | 用已有 Lucide 图标或纯文本替换，并在修改后的完整文件上执行扩展象形字符扫描。 |

现有 `integration.test.ts`、`model.test.ts`、`pet-states.test.ts`、`petWindowRegression.test.ts` 和背景采样测试提供有价值的源码/纯逻辑覆盖，但并不覆盖多显示器、置顶、click-through、托盘、并发动画、独立 WebView 存储同步和真实辅助技术。所有这些应列为发布前真实 Tauri 验收项。

### 3.4 语音现状

1. Rust `voice_wake.rs` 的第一阶段是连续采集、RMS 阈值、VAD 静音结束与 WAV 发射；它没有关键词模型、模型资产、语言配置或唤醒短语比对。它只能称为 VAD 采集占位，不得在 UI 中标为“唤醒词已启用”。
2. Web Speech 路径把最终文本填入 composer，native VAD 路径把 WAV 作为附件直接发送。相同的开关不应拥有不同的确认与会话语义。新的统一状态机必须先生成可见草稿，再由统一的发送策略决定是否提交。
3. 当前本地语音实现没有通过 Gateway 的 `voicewake.get`、`voicewake.set`、`voicewake.routing.get`、`voicewake.routing.set` 或相应变更事件管理触发词与路由。将本地偏好另存为一套权威配置会造成桌面、Gateway 和其他节点不一致。
4. 现有 Rust 测试覆盖陈旧 worker、pre-roll、U16 和 stop 竞争，前端 audit 测试多数是源码断言。仍没有真实麦克风权限、设备断开、关键词误触发、回声、不同采样率、跨窗口 owner、会话切换和 Gateway 重连的端到端证据。

### 3.5 简约性判断

当前系统并非整体“简约”，但有值得保留的简约边界：`main -> projection -> independent WebView` 让宠物和 Dynamic Island 不必复制 Gateway/store；聊天附件路径可复用；VoiceRuntime 已把播放 owner 从多个窗口收敛。后续实现应该保持这些边界，不为 Jarvis 视觉另造一套状态或传输协议。

需要收敛的复杂度是明确的：协作 service 和 Tauri bootstrap 的超大文件、`useVoiceWake` 同时承担浏览器识别/native 事件/队列/会话回调、宠物的两份声音偏好以及辅助窗口缺少统一的 ready/visibility 规则。重构应只围绕有稳定职责的模块边界进行：先抽 strict Gateway client、voice coordinator、native capture/detector 和 window projection，再逐步分解协作 bootstrap。不要以一次“大整理”混合修复、语音功能和文件迁移，否则无法建立可信回归基线。

## 4. 外部协议与技术选择

OpenClaw `v2026.7.1` 将触发词和路由放在 Gateway：`voicewake.get/set` 管理全局 trigger list，`voicewake.routing.get/set` 管理 current、agent 或 session key 目标，并广播配置变化事件。Desktop 必须使用能力探测、严格 decoder、结构化错误分支和当前 Gateway 的 session lookup，而不是根据缓存的可见聊天页猜测目标。参考：[OpenClaw voice wake contract](https://raw.githubusercontent.com/openclaw/openclaw/v2026.7.1/docs/nodes/voicewake.md) 和 [Gateway protocol](https://raw.githubusercontent.com/openclaw/openclaw/v2026.7.1/docs/gateway/protocol.md)。

音频应继续作为普通聊天附件进入 OpenClaw 的 media understanding。上游会将音频处理为 transcript，并经正常回复链路处理失败，这比桌面端伪造消息或自建一条不一致 ASR 管线更符合现有业务边界。参考：[OpenClaw audio processing](https://raw.githubusercontent.com/openclaw/openclaw/v2026.7.1/docs/nodes/audio.md)。

上游 macOS Voice Overlay 的单一 `VoiceSessionCoordinator`、session UUID、陈旧回调丢弃、统一发送和 overlay 只渲染/转发 intent 的模式可以复用；但上游 macOS voice wake 需要 macOS 26，JunQi 当前桌面兼容面不能把它当作所有 macOS 的直接实现前提。参考：[OpenClaw voice overlay](https://raw.githubusercontent.com/openclaw/openclaw/v2026.7.1/docs/platforms/mac/voice-overlay.md) 和 [OpenClaw macOS voice wake](https://raw.githubusercontent.com/openclaw/openclaw/v2026.7.1/docs/platforms/mac/voicewake.md)。

本地检测引擎的选择如下：

| 候选 | 结论 | 原因与约束 |
| --- | --- | --- |
| Sherpa-ONNX KWS + VAD | 推荐进行受控 PoC | 有 Rust/跨平台绑定、离线关键词检测与 VAD 路线，库为 Apache-2.0。每个具体模型的来源、语言效果、体积、准确率和许可仍须单独审核、固定 hash 并随安装包验证。参考：[KWS documentation](https://k2-fsa.github.io/sherpa/onnx/kws/index.html)、[repository](https://github.com/k2-fsa/sherpa-onnx)、[license](https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/LICENSE)。 |
| Picovoice Porcupine | 可选商业路线，不作为默认 | 检测质量和平台覆盖值得评估，但需要 AccessKey、平台模型和商业授权决策。任何 key 都不能进入前端持久化、日志或仓库。参考：[Porcupine documentation](https://picovoice.ai/docs/porcupine/)。 |
| openWakeWord | 当前不选用 | 其预训练模型许可和语言/本地 Rust 集成不适合未经额外授权审计的长期桌面产品。参考：[repository](https://github.com/dscripka/openWakeWord)。 |

## 5. 目标架构

```text
OpenClaw Gateway
  authority: triggers, routing, session identity, media understanding, chat, collaboration
        ^ typed RPC, events, capability and identity checks
        |
VoiceWakeGatewayClient
        |
VoiceModeCoordinator
  authority: one desktop owner, mode/phase/turn state, permission, device, cancellation
        |                                    |
        |                                    +-> VoiceRuntime: output playback only
        v
Native VoiceCaptureService
  capture -> keyword detector -> VAD -> bounded audio turn
        |
        v
normal Chat draft -> explicit send -> chatSendCoordinator -> Gateway
        |
        +-> existing collaboration entry only after user action and durable message identity

VoiceViewProjection
  -> main voice workspace
  -> Dynamic Island
  -> pet state hint
```

### 5.1 Authority 与文件边界

新增能力应按以下职责拆分，避免把视觉状态、Gateway RPC、音频线程和发送副作用重新塞进 `useVoiceWake.ts` 或 `VoiceRuntime.ts`：

| 模块 | 责任 | 不应承担的责任 |
| --- | --- | --- |
| `VoiceWakeGatewayClient` | 严格调用和解码 Gateway voice wake 配置、路由、变化事件与 capability。 | 缓存一份可脱离 Gateway 的 trigger authority。 |
| `VoiceModeCoordinator` | 单例状态机、turnId、目标绑定、取消、权限、设备断线、发送策略和视图投影。 | 直接渲染 UI、播放 TTS 或直接创建协作 Run。 |
| `VoiceCaptureService` | Rust 音频设备、采样率归一、KWS、VAD、pre-roll、bounded WAV、worker 生命周期。 | 决定目标会话、保存 transcript 或调用 Gateway RPC。 |
| `VoiceRuntime` | TTS/播放的跨窗口 owner、stop 和 phase 投影。 | 承担麦克风监听或关键词检测。 |
| main voice workspace | 呈现状态、接收用户 intent、显示草稿和明确确认。 | 持有音频线程或判断 session identity。 |
| Dynamic Island 与 pet | 只渲染最小语义投影，发送 focus/stop intent。 | 订阅 `voice-wake`、抢占麦克风、保存转写或直接发送消息。 |

建议的新类型至少包含：

```ts
type VoiceMode = 'off' | 'push_to_talk' | 'wake_word'

type VoicePhase =
  | 'disabled'
  | 'preparing'
  | 'armed'
  | 'triggered'
  | 'capturing'
  | 'transcribing'
  | 'ready_to_send'
  | 'dispatching'
  | 'waiting'
  | 'speaking'
  | 'error'

type VoiceTurn = {
  turnId: string
  gatewayIdentity: string
  routeTarget: { kind: 'current' | 'agent' | 'session'; value?: string }
  resolvedSessionKey: string | null
  createdAt: number
  cancelRequested: boolean
}
```

每一个 native event、Gateway event、定时器回调和 UI intent 都携带 `turnId`；coordinator 仅接受当前 turn 与当前 Gateway identity 的事件。会话切换、Gateway 重连、runtime 切换、设备变化、stop 或窗口销毁必须取消 turn，丢弃后续回调，而不是重绑到当前可见页面。

### 5.2 状态机与发送策略

```text
disabled -> preparing -> armed -> triggered -> capturing
capturing -> transcribing -> ready_to_send -> dispatching -> waiting -> speaking -> armed
any active phase -> error -> disabled or preparing
any active phase -> disabled when user stops, permission is lost, device disconnects, gateway identity changes, or target is invalid
```

V1 默认采用“草稿确认”策略：关键词或 PTT 只产生当前已解析 target 的普通聊天草稿，用户在主窗口确认后才调用 `chatSendCoordinator.send`。这能防止误唤醒直接触发高成本请求或协作动作，并使浏览器和 native 输入路径一致。未来若加入“普通聊天自动发送”，它必须是用户明确 opt-in 的单独策略，且仅限可验证的普通会话；包含协作入口、批准、删除、取消、系统设置或不完整 target 的输入一律回退为确认草稿。

回复播放期间默认暂停 KWS，沿用现有防回声策略。只有在耳机、回声消除和误触发数据实际验证后，才可以在独立设置中引入 barge-in；它不是 V1 的隐式默认行为。

### 5.3 Gateway 配置与路由

切换到 `wake_word` 时，主窗口先完成以下顺序：

1. 验证当前选择的 Native 或 Docker Gateway 已完成身份、配置和 capability 探测。
2. 从 Gateway 读取 trigger list 与 routing，不用本地缓存覆盖服务端。
3. 检查麦克风权限、选择设备、测试 detector/model 可用性和应用的本地生命周期限制。
4. 解析 routing 到稳定 session/agent identity；无法解析时只显示错误，不猜测当前可见聊天页。
5. 创建新的 coordinator turn，启动 native capture，并把 `armed` 投影给界面。

trigger 或 routing 被其他客户端修改时，Gateway event 会使当前 armed turn 停止并重新读取配置。用户确认发送之前再检查 resolved session、Gateway identity、runtime 和 conversation generation；任一不一致则保留文本草稿并要求用户重新选择目标。

## 6. Jarvis 式桌面界面

本设计借鉴“低干扰、可感知、可中断的命令中枢”体验，不复制影视角色、资产、音效、文案或界面。视觉语言应沿用现有 Aegis token，以石墨灰中性背景、青绿信号色、琥珀注意色和红色错误色表达状态；不使用全屏蓝紫渐变、装饰性光球、仿雷达 HUD 或巨大的营销式标题。

### 6.1 主窗口切换

目标中的语音切换使用稳定宽度的三段式控件：`Off`、`PTT`、`Wake`。当前实现先以 `Off`、`Dictation`、`Wake` 替代 PTT；现有手动录音保持独立路径，直到可访问的按住录音契约完成。切换 `Wake` 时不打开第二个全屏窗口，也不遮掉正在进行的聊天；在消息列表与 composer 之间展开一个无浮层卡片的“voice workspace”带状区域。

```text
+------------------------------------------------------------------+
| Current session / agent          [Off | Dictation | Wake] [Stop] |
+------------------------------------------------------------------+
| Conversation remains readable and receives the normal reply stream |
|                                                                    |
|  Voice workspace                                                   |
|  [ local detector ready ]  target: current session  device: Mic 1 |
|                                                                    |
|             ( calibrated signal ring )       Captured draft        |
|             armed / listening                 transcript preview   |
|                                               [Send] [Discard]      |
+------------------------------------------------------------------+
| Existing composer, attachment actions, and standard send command   |
+------------------------------------------------------------------+
```

该区域在宽屏下采用左侧固定 240 至 280 px 的信号区与右侧文本/动作区；在窄窗口下改为垂直布局。它不是新路由、弹窗或嵌套卡片，聊天上下文始终可读。用户可通过 Escape、stop 图标或切换 Off 立即停止；PTT 的可访问键盘按住模式仍是后续范围。

### 6.2 各阶段视觉状态

| 阶段 | 主窗口 | Dynamic Island | 萌宠 |
| --- | --- | --- | --- |
| preparing | 简短的权限、设备或模型检查行；不可用原因可读且可修复。 | 不显示，除非主窗口最小化且有需要用户处理的错误。 | 无额外动作。 |
| armed | 低频外环和实时 input level，明确显示“本地监听中”与目标；不显示或保存 idle 音频。 | 仅显示 listening、目标摘要和 stop/focus。 | 轻微注视/待命提示，不显示文本转写。 |
| triggered/capturing | 外环加速、时长和可见 stop；只把本地 partial 标为预览。 | 显示 recording 与 stop，不显示原始文本。 | 捕获提示，不能触发任何行为。 |
| transcribing/ready_to_send | 进度和草稿；只有最终结果才启用 Send。 | 显示 processing 或 draft ready。 | 回到普通 thinking 投影。 |
| waiting/speaking | 正常聊天消息流是内容权威；信号环收缩到小状态，TTS 可停止。 | 显示 thinking/speaking 与 stop/focus。 | 复用已有 thinking/typing 提示。 |
| error | 显示错误类别、下一步和 retry；不暗示仍在监听。 | 仅在最小化时显示 attention。 | 不显示原始错误内容。 |

Dynamic Island 只能获得以下派生字段：mode、phase、turn 是否当前、目标的安全摘要、input level bucket、是否需要确认和 error class。它不接收原始音频、partial、最终 transcript、token、模型错误原文或完整 session key。动作只允许 `focus voice workspace` 和 `stop`，由主窗口 coordinator 验证后执行。

宠物保持伴随角色，不新增独立语音状态机。建议在 `PetState` 增加非文本的 `voiceCue` 或将 voice phase 映射到现有等待/思考表现；语音提示必须服从现有审批、错误、工具和资源拖放优先级，且不能用宠物气泡承载隐私敏感转写。

### 6.3 可访问性、隐私和可恢复性

1. 相位变化提供简短、节流后的文本状态和 aria-live，不以动画或颜色作为唯一反馈。
2. `prefers-reduced-motion` 使用静态环与文字，PTT/stop/Send/Discard 都有键盘路径和可读标签。
3. armed idle 阶段仅在内存中处理检测帧，不保存原始音频。被触发的有界音频只按现有聊天附件和用户选择的保留策略提交；诊断只记录匿名/分类计数，不记录音频、转写、token 或 session 内容。
4. 没有权限、设备失联、模型损坏、Gateway 未授权或目标解析失败时立即停用监听，保留可处理的草稿或设置，而不是降级到隐式浏览器监听。
5. 应用退出后 V1 不声称持续监听。未来常驻能力需要单独的系统服务、签名、启动项、权限、耗电和隐私设计，不能在窗口 feature 中偷偷加入。

## 7. 分阶段实施

### Phase 0：先收敛现有风险和证据

- 修复 DI-01 与 PET-01 至 PET-05，并给每项添加行为回归和真实 Tauri 验收记录。
- 修复 Docker 快路径身份验证、AgentRun task identity 竞争、任务深链 canonical route、未知路由恢复和 Agent 进程树取消语义，避免语音成为错误 Gateway 或错误任务的入口。
- 清除 PET-06，并把完整文件 emoji 扫描纳入修改宠物界面的本地检查。
- 把协作 bundle/schema/hash 的文档与当前制品同步，建立“发布证据只能绑定当前 tgz”的自动检查，明确 template version 和 parameters 的产品语义。
- 将本文件中的状态、默认确认策略、隐私范围和未验证边界转成独立 implementation spec/plan 后再改代码。

### Phase 1：统一语音状态与 Gateway 契约

- 引入严格类型化的 `VoiceWakeGatewayClient` 和 `VoiceModeCoordinator`，保留 `VoiceRuntime` 的播放职责。
- 接入 `voicewake.get/set/routing.get/routing.set`、Gateway changes、capability 和 identity fence；对方法不存在、scope 拒绝和结构化错误逐一分支。
- 将现有 Web Speech 和 native VAD 都收敛为“生成草稿”的一个用户语义，先提供 Off/PTT，Wake 仍明确标为 unavailable until detector installed。
- 增加单测：陈旧 event、route 变更、session 切换、Gateway 重连、stop、重复开始和草稿不自动创建协作 Run。

### Phase 2：本地检测器 PoC

- 在 Rust 侧定义 detector trait，并把 capture、resample、KWS、VAD、WAV packaging 和事件协议拆出 `voice_wake.rs`，避免继续扩大单文件。
- 以 Sherpa-ONNX 做受控离线 PoC；模型作为可审计的版本化资源，记录来源、hash、大小、许可证、支持语言、设备基准和误触发数据。
- 验证 macOS、Windows、Linux 的权限、热插拔、采样率、CPU、内存、休眠恢复、扬声器回声和停止时延。PoC 不通过则 Wake 保持不可用，PTT 不受影响。

### Phase 3：主窗口与辅助窗口投影

- 实现 chat 内 voice workspace、三段式模式控件、草稿确认和可访问性状态。
- 扩展 Dynamic Island 语义投影和 pet `voiceCue`，不创建新的 microphone owner 或独立语音窗口。
- 只在主窗口状态机、原生竞争和多显示器验收稳定后，再评估一个小型 Tauri voice overlay；overlay 也必须只是 renderer/intent forwarder。

### Phase 4：真实链路和协作约束

- 用真实、隔离的 OpenClaw `2026.7.1` Gateway 验证 trigger/routing、配置变更、session resolution、音频附件转写、失败回复和 selected runtime identity。
- 验证确认后消息才可进入现有协作入口，且未取得 `nativeMessageId`、断线、instance 变更、session reset/delete、误唤醒时均为零 Run、零 approval、零控制 RPC。
- 处理历史协作 P0 real runtime、视觉和 soak 缺口，不能借语音测试替代它们。

### Phase 5：可选实时 Talk

- 仅在运行时探测到 `talk.catalog`、模型/provider、权限与健康条件后展示 Talk。
- Talk 复用同一个 coordinator、target fence、stop、确认与隐私模型；缺失能力时不模拟可用状态，也不把 Web Speech 当作等价替代。

## 8. 验收矩阵

| 层级 | 必须证明的行为 |
| --- | --- |
| Unit | detector/VAD 边界、turnId 陈旧事件丢弃、状态机穷尽、stop 幂等、route/session/Gateway identity fence、草稿确认策略。 |
| Tauri contract | 所有 command 在 `lib.rs` 注册；前端 command 名、参数外层、serde 字段和返回类型一致；worker 与窗口关闭无泄漏。 |
| Gateway integration | 真实 `voicewake` get/set/routing/change、方法不存在与权限拒绝、音频附件到 transcript、selected Native/Docker identity、Gateway 重连。 |
| Collaboration | 未确认草稿零 RPC；确认消息前零 Run；任何语音输入零自动 approve/cancel/delete；导出、SQLite、事件和日志不含音频或转写。 |
| Desktop hardware | macOS/Windows/Linux 权限、多个输入设备、热插拔、采样率、休眠、扬声器/耳机、最小化、关闭窗口和重启恢复。 |
| Visual and accessibility | 主窗口窄宽度、Dynamic Island click-through/关闭竞争、宠物 ready/偏好同步、多显示器、键盘、缩减动画和辅助技术。 |
| Soak and release | 长时间 armed、重复 wake、CPU/内存、设备断线恢复、24 小时 soak、当前 bundle hash/schema 与证据绑定。 |

每个阶段只有在最小相关测试、`git diff --check`、目标平台的明确真机记录和未验证边界同步后才可推进。自动化通过、历史验证和开发机已有凭据都不能替代这些门禁。

## 9. 推荐的实施顺序

长期收益优先于视觉炫技，推荐的提交顺序是：先修复入口/辅助窗口已知竞争和证据债务；再建立 Gateway authority 与单一 coordinator；然后以听写和未来 PTT 验证发送、路由、取消和隐私；通过本地 KWS PoC 后才暴露 Wake；最后才扩大到岛、宠物、overlay 和实时 Talk。这样每一步都有清晰 authority、可回滚边界和独立验收，不会把一个“Jarvis 风格界面”变成新的并发状态中心。

## 10. 2026-07-31 实现记录

本节记录本次分支的实际代码状态；第 3 节中的问题描述保留为实施前审计依据。

### 已实现的行为

1. PRE-01：Docker 快路径现复用选定配置与认证身份匹配，而非只依赖容器和 health endpoint；任务入口统一到 `/agent-run?taskId=...`，旧的无歧义任务链接在路由层 canonicalize；同一路由的任务切换以 task id 重挂载。Agent PTY 取消路径也补充了任务终止语义回归。
2. DI-01 与 PET-01 至 PET-06：Dynamic Island 的 close intent 优先于排队 expand；宠物的可见性、展示偏好、声音 authority、失败重试和 ready snapshot 已统一到跨窗口协议。
3. 语音 authority：`VoiceModeCoordinator` 为每轮输入保有 mode、phase、turn、session key、attested Gateway identity、草稿和错误。停止、组件卸载、切换 target 或 Gateway 后，旧回调不能复活该轮；捕获 owner 的释放由 coordinator 向主窗口 hook 发出请求。异步启动和确认草稿前都会重检当前 session 与 attested connection，卸载只可释放其拥有的 turn。
4. 语音输入：浏览器识别和 native VAD capture 都只生成确认草稿。文本确认写入普通 composer，音频确认才经既有 `chatSendCoordinator` 发送普通附件；手动录音的原行为未改变。语音层没有调用协作 RPC。
5. Gateway 协议：`VoiceWakeGatewayClient` 严格解码 `voicewake.get`、`voicewake.set`、`voicewake.routing.get`、`voicewake.routing.set` 和两种 change event，并用当前 attested connection fence 请求。routing target 必须恰好是一种 target discriminator，畸形 payload 不会被静默解释。当前 UI 仅用读取结果验证 Gateway 可用性；没有 detector 时 Wake 保持 unavailable。
6. 视图投影：聊天内工作台提供 Off、Dictation、Wake、状态、确认、丢弃和 stop。Dynamic Island 只获得 mode、phase、是否需要确认和错误类别；宠物只把 active capture phase 映射到已有非文本 thinking cue。二者均不能发送、捕获或调用 Gateway。

### 当前验证与边界

- 已完成 `pnpm install --frozen-lockfile`、`pnpm lint`（含 656 个文件的边界检查和 TypeScript 严格检查）、`pnpm test`（1,991 个前端测试与 224 个脚本测试）、`cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib`（659 通过，3 个现有环境依赖测试忽略）、`pnpm build` 和 `git diff --check`。构建重新生成 collaboration bundle 后没有产生额外工作树差异。
- 未执行真实 Gateway `voicewake` RPC、选定 Native/Docker runtime 身份、麦克风权限、设备热插拔、真实 detector/model、跨平台最小化窗口、辅助技术和多显示器验收。
- Wake 仍不是可发布的关键词唤醒功能。Rust 的 VAD 继续只服务于听写 capture；没有审计过的本地 detector/model 时 UI 明确显示 unavailable。
- PTT、系统级常驻、Talk、自动发送和所有协作控制操作仍不在本次实现范围内。
