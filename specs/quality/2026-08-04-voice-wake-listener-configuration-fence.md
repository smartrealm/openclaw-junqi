# 语音唤醒监听配置围栏规格

日期：2026-08-04

## 问题

原生监听器把任意运行中的 worker 视为可复用，未区分 `dictation`、`wake_word` 和 PCM 流请求。前端也未验证启动回执是否真的满足本次请求，导致 UI 状态和实际采集能力可能分离。

## 目标

1. 同一采集配置的重复启动保持幂等。
2. 模式或 PCM 流配置变化必须串行替换旧 worker，旧 worker 不得发出影响新监听器的事件或被交错请求覆盖。
3. 前端只接受 `listening: true` 且模式精确匹配请求的启动回执。
4. 不改变 OpenClaw Voice Wake、Talk、session category、Gateway 身份或路由契约。

## 验收

- Rust 纯逻辑测试证明相同配置可复用，不同配置必须替换。
- `voice_wake_start` 的返回状态仍满足既有 TypeScript `VoiceWakeStatus` 契约。
- 前端出现错误或非匹配回执时保持失败关闭，不能显示 listening。
- 相关 TypeScript、Rust、完整前端测试、构建、官方文档链接检查和 diff 检查通过。

## 非目标

- 不加入新的语音服务、浏览器 WebRTC、平台特化监听实现或模型下载机制。
- 不声称任何未完成真机验证的平台可用。
