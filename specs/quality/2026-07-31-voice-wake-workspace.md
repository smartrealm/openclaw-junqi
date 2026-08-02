# 语音唤醒工作台实施规格

日期：2026-07-31

状态：代码与完整本机自动化验证完成，等待真实环境验收

## 范围

本规格落实 `docs/design/voice-wake-jarvis-surface-design-2026-07-31.md` 的 Phase 0 到 Phase 3。真实关键词模型、模型资产分发、真实 Gateway 验收、系统常驻和 Talk 不在本次代码改动范围内。

### VWS-01 单一语音模式状态机

当前：浏览器连续听写和 native VAD 回调直接操作 composer 或发送附件，模式、turn 和目标身份没有独立 authority。

目标：`VoiceModeCoordinator` 以严格类型管理 mode、phase、turnId、session key、Gateway identity、草稿和错误。陈旧事件、不同 Gateway 或不同 target 的结果必须丢弃；stop 必须幂等。

验收：

- 捕获只能产生草稿，不能直接调用 collaboration RPC。
- session/Gateway fence 改变后，旧 turn 不能写入草稿或发送。
- stop 后的 capture、transcript 或 native event 不改变 state。

### VWS-02 统一草稿确认路径

当前：Web Speech 把文本填入 composer，native VAD 把 WAV 直接发送。

目标：两条路径都先交给 coordinator，用户在主窗口确认后才将文本写入 composer 或发送普通音频附件。协作入口继续只接受持久用户消息。

验收：

- native capture 不直接调用 `chatSendCoordinator`。
- 取消或 target 变化保留可见草稿但不发送。
- 现有手动语音录制保持独立行为。

### VWS-03 聊天内 voice workspace

当前：输入区只有 dictation 菜单和短状态 banner。

目标：聊天内加入 Off/Dictation/Wake 模式控件、语音状态带、草稿确认、停止和可访问状态；Wake 只在本地 detector 可用时进入 armed，否则显示明确 unavailable。PTT 保持后续范围，现有手动录音不改变。

验收：

- 控件不隐藏普通会话和 composer。
- 带状工作台适配窄窗口、键盘 stop 和 reduced motion。
- UI 不新建 microphone owner。
- Wake 不得把 VAD 表述为关键词检测。

### VWS-04 辅助窗口投影

当前：Dynamic Island 与宠物消费 `VoiceRuntime` 播放状态，但没有语音 mode/turn 的最小语义投影。

目标：主窗口向辅助窗口投影 mode、phase、是否需要确认和错误类别，不传播 transcript、音频、token、turn 或完整 session key。辅助窗口只可请求 focus/stop。

验收：

- 辅助窗口不能开始 capture、发送消息或直接调用 Gateway。
- 主窗口停止后 island/pet 投影同步 idle。
- 业务注意状态继续优先于被动语音状态。

### PRE-01 前置闭环修复

当前：入口、任务路由、Dynamic Island 和宠物已发现的竞争或同步问题会让语音显示错误 runtime、错误 task 或陈旧窗口状态。

目标：完成 Docker 身份验证、AgentRun identity、canonical task deep link、Dynamic Island close、宠物 visibility/preferences/sound/retry/ready 等修复及回归。

验收：

- 每项修复有能覆盖原始故障路径的回归测试。
- 修复不绕过 Native/Docker runtime 选择、聊天发送或协作批准边界。

## 实现记录

| 条目 | 当前行为 | 自动化证据 | 未验证边界 |
| --- | --- | --- | --- |
| PRE-01 | Docker identity、AgentRun route identity、任务深链、Dynamic Island lifecycle 与宠物跨窗口状态已修复。 | 对应 TypeScript/Rust 回归已新增；完整命令结果在计划记录。 | 目标平台窗口、Docker 冷启动和原生凭据仍需真机。 |
| VWS-01 | coordinator fence 陈旧 turn、target/Gateway 变化；异步启动、确认和卸载仅可操作拥有的 attested turn，stop 同时请求释放 capture owner。 | `VoiceModeCoordinator.test.ts`、`useComposerVoice.test.ts`。 | 真实重连与设备断开。 |
| VWS-02 | Web Speech/native VAD 先生成草稿；音频只在确认后走普通附件发送。 | `useComposerVoice.test.ts` 与 coordinator 测试。 | 真实媒体与 Gateway 音频理解。 |
| VWS-03 | 聊天内提供 Off、Dictation、Wake；Wake 无 detector 时显示 unavailable。模型配置、登录启动和 detector 状态均由 composer hook 通过 typed IPC adapter 管理，界面不直接访问 Tauri。确认或丢弃草稿后，同一已认证会话会重新进入待命；native listener 失败按有上限的指数延迟重试。 | `MessageInput.composer.test.ts`、`useComposerVoice.test.ts` 与 native voice-wake 测试。 | PTT、键盘按住和真实 detector。 |
| VWS-04 | Island 只收到最小非敏感 cue，宠物只映射 capture phase；Island stop 请求 coordinator 释放 capture。 | `dynamic-island/model.test.ts`、`integration.test.ts`、`voiceModeProjection.test.ts`。 | 最小化窗口、跨 WebView 与多显示器。 |

## 本机验证

- `pnpm install --frozen-lockfile` 通过，未修改 lockfile。
- `pnpm lint` 通过，包含 656 个文件的模块边界检查与 TypeScript 严格检查。
- `pnpm test` 通过，1,991 个前端测试与 224 个脚本测试通过。
- `cargo fmt -- --check`、`cargo check --lib` 和 `cargo test --lib` 通过；Rust library 测试为 659 通过、3 个忽略、0 失败。忽略项需要 macOS Keychain 写入或已认证的 Codex CLI 环境。
- `pnpm build` 与 `git diff --check` 通过。构建生成的 collaboration bundle 与现有受跟踪资源一致，未产生额外差异。

这些结果不替代真实 Gateway、选定 runtime、真实麦克风与 detector、跨平台窗口和辅助技术验收。

## 约束

- 不在前端 persist trigger、audio、transcript、Gateway token 或 device credential。
- 不使用 `any`、强制断言或静默 default 掩盖 Tauri/Gateway 契约。
- 真实唤醒词功能没有经许可审核的 detector/model 时必须不可用，不能把 VAD 标为 wake word。
- detector 模型配置必须原子写入；IPC 返回数据必须由 typed adapter 校验，不能由 UI 假定字段结构。
- Native 与 Docker 不可互相静默回退。
- 所有协作行为必须从用户确认后的普通消息与现有入口开始。
- 本次不把 VAD、浏览器连续听写或静态测试称为真实 Wake、真实 Gateway 或正式发布验收。
