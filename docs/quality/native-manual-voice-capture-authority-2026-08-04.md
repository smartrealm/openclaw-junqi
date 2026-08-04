# 原生手动语音采集权威链路审计

日期：2026-08-04

## 依据

- JunQi 根 `AGENTS.md`：桌面核心能力必须由 Tauri、Rust、系统 API 或 OpenClaw Gateway
  的桌面可用契约实现；WebView API 不能成为音频采集的权威实现。
- 当前 OpenClaw 官方协议：`chat.send` 接受附件；Gateway 负责附件进入会话与 Agent 的处理，
  不定义桌面麦克风、设备选择、录音暂停或本地 WAV 文件生命周期。
- 当前 JunQi `voice_start_recording` / `voice_stop_recording` 使用 CPAL 采集默认输入设备并
  产出 WAV，`useComposerVoice` 将该 WAV 通过既有附件事务发送到选定 OpenClaw 会话。

## 审计发现

此前 `VoiceRecorder` 优先使用 WebView 的 `getUserMedia`、`MediaRecorder` 和 `AudioContext`，
只有该路径失败后才调用原生录音。该顺序使 macOS、Windows 和 Linux 桌面行为受 WebView
权限、编解码器和实现差异支配，也让波形与暂停控件依赖并非原生提供的音频分析能力。

原生录音的停止命令此前没有实例身份。组件卸载、Strict Mode 重挂或并发打开后，迟到的停止
请求可能误操作后启动的全局录音槽位。

## 目标行为

1. 手动录音仅通过 Tauri 原生命令采集；WebView 不再请求麦克风、不再创建音频上下文，
   不再编码浏览器录音容器。
2. 原生开始结果返回不可预测的录音实例标识；停止命令必须携带该标识。标识不匹配时拒绝
   操作，不停止后来替换的录音。
3. 原生录音不提供可验证的实时音量或暂停能力时，界面不得伪造波形、音量或暂停状态；只
   呈现真实的开始、录制、发送、取消和失败状态。
4. 完成录音后继续复用现有 `useComposerVoice` 附件事务、会话身份、运行目标、发送队列与
   OpenClaw `chat.send` 契约；本地采集不得改写 Gateway transcript 或捏造语音转写。

## 非目标

- 不新增 OpenClaw RPC、语音转写、实时音量协议、浏览器兼容 fallback 或第二个 Agent。
- 不声称 CPAL 在未进行真机授权验证的平台已可用。
- 不改变 Jarvis 唤醒、Talk relay、TTS 播放、Gateway scope 或普通附件大小限制。

## 验证与边界

自动化覆盖录音实例标识在前端包装、Rust command 注册和停止命令中的一致性，以及取消、发送、
卸载与过期开始结果不会停止不匹配实例。

已执行并通过：

- 手动语音、聊天附件与 Tauri wrapper 定向回归：41 项通过；
- `pnpm lint`；
- `pnpm test`：2797 项通过；
- `cargo fmt -- --check`、`cargo check --lib`、`pnpm test:rust`：709 项通过，3 项因外部
  模型夹具未提供而忽略；
- `pnpm build`；
- `pnpm verify:openclaw-docs`。

提交前还会执行 `git diff --check`、无引用路径检索和改动完整文件的 Emoji 扫描。

本机自动化不能证明 macOS 麦克风授权、Windows WASAPI 设备策略、PulseAudio 或 PipeWire
配置、CentOS/Ubuntu 依赖库、蓝牙输入切换和长录音稳定性；这些必须在目标平台独立真机验收。
