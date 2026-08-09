# Jarvis 全链路审计

日期：2026-08-09

## 审计范围

本次核对 Jarvis 开启后的主窗口遮罩、灵动岛和萌宠投影，手动 Talk 的麦克风到 Gateway 音频链路，语音输出与打断，Voice Wake 配置、路由和会话绑定，以及 macOS、Windows、Linux 桌面边界。

## 结论

当前 JunQi 已具备“用户主动点击 Talk 后，在当前 OpenClaw session 中进行连续语音交互”的客户端链路，但 Jarvis 全线功能尚未闭环。最重要的缺口是：JunQi 没有 Voice Wake 运行时，也没有唤醒命中事件到 `JarvisVoiceRuntime` 的入口；设置页保存的触发词和路由只改变 Gateway 配置，不会让桌面应用开始监听或在命中后启动 Talk。

OpenClaw 官方当前文档将 Voice Wake 运行时定义在 macOS、iOS 和 Android 客户端；Gateway 协议提供的是 `voicewake.get/set` 配置 RPC 与 `voicewake.changed` 配置事件，Talk 则通过 `talk.catalog`、`talk.session.*` 和 `talk.event` 工作。官方没有为 Windows、Ubuntu 或 CentOS 通用桌面客户端定义后台唤醒协议。因此本项目不能用本地关键词模型、后台麦克风线程或伪造 Gateway 事件补齐该能力。

## Findings

### 高风险：唤醒词配置没有运行时消费者

证据：

- `src/services/gateway/VoiceWakeGatewayClient.ts` 只实现 `voicewake.get`、`voicewake.set`、`voicewake.routing.get`、`voicewake.routing.set`。
- `src/services/gateway/voiceWakeEventBridge.ts` 只处理 `voicewake.changed` 和 `voicewake.routing.changed`，这两类都是配置变更事件。
- `src/hooks/useVoiceCapture.ts:38` 明确声明只管理用户主动开始的连续采集，不实现唤醒词或后台待机。
- 全局调用图中没有 Voice Wake 命中事件、唤醒转写事件或唤醒后 `startTalk` 调用。

影响：设置页可以保存“Jarvis”触发词，却不能在 JunQi 桌面中真正被该词唤醒。当前只能把它标记为 Gateway 配置编辑，不能标记为已启用的 24 小时语音助手。

### 高风险：路由目标没有进入当前 Talk 会话

证据：

- `src/components/settings/JarvisVoiceSettingsPanel.tsx:139-153` 只把 Gateway 返回的 agent/session 目标投影为编辑选项。
- `src/runtime/JarvisVoiceRuntime.tsx:29-55` 只从 `useChatStore.activeSessionKey` 创建控制器。
- `src/components/Chat/message-input/useComposerVoice.ts:189-211` 只用当前活动 session 创建 `talk.session.create`，没有消费 Voice Wake 路由目标。

影响：即使 Gateway 侧存在 `agentId` 或 `sessionKey` 路由，当前 JunQi 手动 Talk 仍只针对活动会话；由于没有唤醒事件入口，路由配置在本客户端没有可验证的触发效果。不能宣称“唤醒词自动归属对应 agent/group”。

### 中风险：灵动岛的展示是有条件的，不是 Jarvis 全窗口同时展示

证据：

- `src/dynamic-island/DynamicIslandRuntime.tsx:183-194` 将 Jarvis voice 状态纳入 `voiceActive`。
- `src/dynamic-island/model.ts:211-218` 在主窗口未最小化时直接返回不显示；只有主窗口最小化、预览或资源拖拽时才显示。
- `src/runtime/JarvisVoiceRuntime.tsx:61-68` 的 Jarvis 遮罩覆盖应用 WebView 全窗口，并负责停止、重试和焦点管理。

当前行为是：主窗口可见时只显示全窗口 Jarvis 遮罩，不重复显示灵动岛；主窗口最小化后，灵动岛才投影非敏感语音阶段。这个行为与现有审计文档一致，是明确的展示决策，不是运行时唤醒闭环。

### 已验证：手动 Talk 的中断和输出边界基本完整

- Talk session 固定创建时的 Gateway connection lease，连接变化会失败关闭旧租约。
- 原生 CPAL 采集只转发已拥有的 PCM 帧，播放由 Tauri 原生 PCM 播放命令处理。
- 用户开口和停止会调用官方 `talk.session.cancelOutput`、`talk.session.cancelTurn`、`talk.session.close`，同时释放本地采集和播放资源。
- `openclaw_agent_consult` 通过官方 `talk.client.toolCall`、`agent.wait` 和 `talk.session.submitToolResult` 中继，未向聊天 transcript 伪造结果。

这些结论只代表代码和自动化契约，不代表真实提供方、麦克风、扬声器或目标平台已经通过验收。

## UI 当前表现

1. 用户从会话输入区主动开启 Talk 后，`JarvisVoiceOverlay` 覆盖整个应用窗口，显示阶段、当前 session、用户转写、助手文本、停止和错误重试。
2. `Escape`、右上角关闭和底部停止都进入同一资源释放路径；停止不删除 OpenClaw session 历史。
3. 萌宠只读取 `voiceModeCoordinator` 和 `useVoiceStore` 的阶段投影，不持有音频帧、转写或凭据。
4. 灵动岛只接收阶段和连接等非敏感投影；主窗口未最小化时按设计隐藏，避免与全窗口遮罩重复。

## 官方依据

- [OpenClaw Voice Wake（macOS）](https://raw.githubusercontent.com/openclaw/openclaw/main/docs/platforms/mac/voicewake.md)：定义原生 `VoiceWakeRuntime`、本地唤醒识别、权限和唤醒后 overlay 生命周期。
- [OpenClaw Talk mode](https://raw.githubusercontent.com/openclaw/openclaw/main/docs/nodes/talk.md)：定义连续听取、转写、Gateway 会话、TTS、打断和不同客户端形态。
- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)：定义 `voicewake.*` 配置 RPC、`talk.catalog`、`talk.session.*` 和 `talk.event`，未定义通用桌面 Voice Wake 命中事件。

## 未验证边界

- 当前 Gateway 的实时提供方、凭据、麦克风和扬声器尚未完成真实 Talk 端到端验收；此前只读探测为 `talk.catalog.realtime.ready=false`。
- 未在 Windows、Ubuntu、CentOS 真机验证音频权限、设备切换、休眠恢复、安装器和后台生命周期。
- 未取得 OpenClaw 官方通用桌面唤醒协议，因此不能实现跨平台 24 小时唤醒；这是待上游能力或官方节点扩展的边界，不是可用 fallback 的开发任务。

## 下一步顺序

1. 在一个真实 Gateway 和真实音频设备上验证手动 Talk：创建、转写、回复、播放、开口打断、Stop、重连和同一 session 恢复。
2. 对照最新版 OpenClaw 官方客户端/节点是否新增可供 Tauri 桌面接入的 Voice Wake 扩展点；只有获得正式协议或官方插件契约后，才设计唤醒事件适配。
3. 在没有官方桌面唤醒契约前，调整 UI 文案和设置状态，明确区分“Gateway 唤醒词配置”和“JunQi 手动 Talk”，不显示“已启用 24 小时唤醒”。
4. 依次在 macOS、Windows、Ubuntu、CentOS 记录设备、权限、休眠和安装包实测结果；任何未知能力保持待验证，不切换到浏览器或本地伪实现。
