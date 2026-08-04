# 原生桌面语音采集边界实施计划

日期：2026-08-04

1. [x] 对照官方 OpenClaw Voice Wake 与 Talk 文档，确认浏览器 client transport 和 Gateway relay 是不同形态。
2. [x] 审阅 JunQi 的 React 调用链、Tauri command、Rust CPAL worker 和现有语音规格。
3. [x] 删除 WebView `SpeechRecognition` 路径，保留 owner 绑定的原生采集。
4. [x] 删除浏览器专用的文本回调和语言参数，保持原生音频草稿及 PCM relay。
5. [x] 为原生 Tauri 启动请求补充模式、PCM、owner 的可执行契约测试。
6. [x] 重新核对本机官方 OpenClaw 源码；记录 transcription relay 与当前原生媒体格式不兼容，保持 fail-closed。
7. [x] 运行完整静态检查、前端测试、构建、官方文档链接检查和 diff 检查。
8. [ ] 在真实 Windows、CentOS、Ubuntu 和 macOS 安装包上验收麦克风权限、托盘、登录启动、睡眠恢复与窗口恢复。
