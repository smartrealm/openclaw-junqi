# OpenClaw Talk 全局输出所有权实施计划

日期：2026-08-04

## 实施顺序

1. 核对 OpenClaw Gateway protocol 与 `talk.ts` 中的 relay、event、barge-in 取消契约，以及
   JunQi Tauri PCM command 的进程级所有权。
2. 为 VoiceRuntime 添加 Talk 输出 claim、仅属主可释放的状态和共享 PCM 停止依赖；保持已有
   Gateway TTS 与 MEDIA 行为。
3. 让 composer 在现有 local interrupt 事件中只对 matching 且 speaking 的 Talk 协调器调用现有
   `interrupt()`，以复用官方 `talk.session.cancelOutput` 路径。
4. 先补跨窗口 Talk 抢占、重复停止和错误隔离回归，再运行定向、静态、全量和 Rust 验证。
5. 记录真实 Gateway 与目标系统多窗口音频未验证边界。

## 文件范围

- `src/services/voice/VoiceRuntime.ts`
- `src/services/voice/VoiceRuntime.test.ts`
- `src/components/Chat/message-input/useComposerVoice.ts`
- `docs/quality/2026-08-04-openclaw-talk-global-output-ownership.md`
- `specs/quality/2026-08-04-openclaw-talk-global-output-ownership.md`
- 本计划及三个索引

## 验证

```bash
pnpm exec tsx --test src/services/voice/VoiceRuntime.test.ts
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
pnpm verify:openclaw-docs
cd src-tauri && cargo fmt -- --check && cargo check --lib && cargo test --lib
git diff --check
```

## 未验证边界

自动化无法证明真实 Gateway `talk.session.cancelOutput` 的 provider 时延，也不能替代 macOS、Windows、
CentOS、Ubuntu 上多窗口、设备切换、休眠恢复和音频权限的真机验证。

## 执行结果

1. Talk speaking 已声明既有全局输出 claim；后到的 claim 和 Stop 会先停止共享 PCM，再通知会话属主复用
   官方 `talk.session.cancelOutput` 路径。
2. Rust Stop 现在等待 worker acknowledgement 并在等待期间保持播放单例锁，避免新 worker 与旧 sink
   并行建立。
3. 已补 Talk 会话作用域取消、跨窗口 Talk 抢占和 Stop acknowledgement 回归。
4. `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`、Rust format/check/test 与 diff
   检查通过。
