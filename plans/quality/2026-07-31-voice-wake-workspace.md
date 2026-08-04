# 语音唤醒工作台实施计划

日期：2026-07-31

状态：代码与完整本机自动化验证完成，等待真实环境验收

## Phase A 前置闭环（完成）

- PRE-01：修复 Docker fast path 身份验证。
- PRE-01：修复 AgentRun 同路径 task identity、canonical deep link、unknown route recovery 和 task cancellation 语义。
- PRE-01：修复 Dynamic Island 生命周期竞争、宠物 visibility、preferences、sound、open retry 和 ready snapshot。

## Phase B 语音 authority（完成）

- 新增 services voice coordinator 及纯状态测试。
- 将原生 VAD 回调收敛到 coordinator，保留 `VoiceRuntime` 的播放职责；浏览器 Web Speech 已于 2026-08-04 移除。
- 使用 attested connection fence 的 Gateway `voicewake` adapter 已实现；没有已验证 detector 时 Wake 显示 unavailable，不伪造服务端配置。

## Phase C 聊天工作台（完成，PTT 延后）

- 在 `MessageInput` 上方增加可访问 voice workspace。
- 使用 coordinator 草稿确认写入 composer；手动录音维持原有附件发送。
- 增加 Off/Dictation/Wake 控件和 stop 入口；PTT 需独立的按住录音、无障碍和设备契约后再实施。

## Phase D 辅助窗口（完成）

- 在 Dynamic Island 与宠物的投影中加入最小 voice mode state。
- 保持 island/pet 只读和 intent-forwarding 边界。

## Phase E 验证（本机自动化完成）

- 为每项 PRE/VWS 编写行为或契约回归。
- 执行相关 TypeScript/Rust 测试、lint、Rust format/check/test、边界检查、diff check。
- 记录未执行的真实 Gateway、硬件和模型验收。

## 已完成范围

- PRE-01：Docker fast path identity、AgentRun task identity/canonical route、Dynamic Island close intent 与宠物窗口同步修复。
- VWS-01：`VoiceModeCoordinator`、严格 Gateway decoder/event bridge、capture owner release 和 stale turn fence。
- VWS-02：原生 VAD 进入音频确认草稿；手动录音仍走原有直接附件发送。
- VWS-03：聊天内 voice workspace、三种模式、状态、确认、丢弃和 stop；Wake 在没有真实 detector 时显式 unavailable。
- VWS-04：Dynamic Island 最小 cue 和 stop intent，宠物既有非文本 thinking cue。

## 实际验证

- `pnpm install --frozen-lockfile` 通过，未修改 lockfile。
- `pnpm lint` 通过：模块边界检查 656 个文件，TypeScript 严格检查通过。
- `pnpm test` 通过：1,991 个前端测试与 224 个脚本测试通过。
- `cargo fmt -- --check` 与 `cargo check --lib` 通过。
- `cargo test --lib` 通过：659 通过、3 个忽略、0 失败。忽略项依赖 macOS Keychain 写入或已认证的 Codex CLI 环境。
- `pnpm build` 通过：collaboration bundle、TypeScript 与 Vite production build 均成功，未留下额外受跟踪生成物差异。
- `git diff --check` 通过。

## 未完成边界

- 真实关键词 detector/model、模型许可证与资源分发。
- PTT 按住交互、全局/系统级监听、Talk 和自动发送。
- 真实 OpenClaw Gateway、Native/Docker selected runtime、硬件权限、热插拔、多显示器和目标平台窗口验收。
