# 原生手动语音采集权威规格

日期：2026-08-04

## 目标

JunQi 手动语音消息在所有桌面目标上只通过本地 Tauri 原生录音采集，并将完成的 WAV 交给
既有 OpenClaw 附件发送事务。

## 约束

1. `VoiceRecorder` 不得使用 `navigator.mediaDevices`、`MediaRecorder`、`AudioContext`、
   `MediaStream`、浏览器录音文件或浏览器麦克风 fallback。
2. `voice_start_recording` 成功时返回非空录音实例标识；`voice_stop_recording` 只接受该
   精确标识，实例不匹配不得停止当前录音。
3. 组件开始、发送、取消、卸载和禁用切换均绑定同一实例标识；任何过期异步结果只能清理
   自己创建的原生录音。
4. 没有原生实时电平和暂停契约时，UI 只能展示录制时长与真实命令状态，不能展示伪造的
   波形或可用暂停操作。
5. WAV 的 MIME、文件名、大小校验、选定 session、运行目标和发送事务继续由现有
   `useComposerVoice` 与 OpenClaw `chat.send` 附件路径权威控制。

## 验收

- 启动、停止、取消与卸载通过 typed Tauri wrapper 使用同一录音实例标识。
- 迟到的停止请求不会停止不同标识的活跃录音。
- 原生采集失败会显示现有可恢复错误，不会静默改用 WebView 或伪造录音成功。
- 成功采集继续发送 `audio/wav` 附件，不向 OpenClaw 写入本地语音状态或转写结果。
- 回归测试覆盖实例围栏和无浏览器采集依赖；跨 TypeScript/Rust command 的注册、参数命名和
  返回字段保持一致。
- 自动化与目标平台未验证边界在对齐记录中明确区分。
