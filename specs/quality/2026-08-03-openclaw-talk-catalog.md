# OpenClaw Talk 能力目录对齐规格

日期：2026-08-03

## 背景

JunQi 是 OpenClaw 的桌面客户端。连续语音必须由 Gateway 原生 Talk relay 提供，不能用本地 UI 状态或旧目录形状推断 provider 能力。当前官方 `talk.catalog` 将能力划分为 `speech`、`transcription`、`realtime` 三组，`realtime.ready` 和 provider 的格式、传输、brain、barge-in 字段共同决定是否可以建立桌面 relay。

## 约束

1. 目录字段和枚举只以 OpenClaw 官方文档、schema 和 handler 为准，不以 package 版本号选择分支。
2. `ready`、音频格式和 barge-in 等可选字段缺失时保持未知，不用本地默认值补齐。
3. JunQi native worker 当前只发送和播放 PCM16 24000Hz 单声道；Gateway 未声明输入和输出均支持该格式时不得创建 relay。
4. `speech.ready`、单一 `providers` 列表和前端乐观状态不是 OpenClaw 当前 Talk 事实来源。
5. 目录不可用、连接切换和 session 响应不合法时必须显示不可用或错误，不自动切换到浏览器 WebRTC、本地伪造 TTS 或其他未声明路径。

## 验收条件

- 当前官方三组目录可以解码并保留 `realtime.ready`、active provider 与 provider capability。
- 配置完整且能力明确的 provider 才会生成 `talk.session.create` 的 `realtime/gateway-relay/agent-consult` 参数。
- 旧 `speech.ready` 目录、realtime 未 ready、缺少输入/输出 native 格式或缺少 barge-in 时不会发起 session create。
- 目录解析器拒绝缺少官方必填字段或已出现字段类型错误的数据。
- 文档明确区分 OpenClaw 原生能力、JunQi 本地音频格式边界和未验证的跨平台运行证据。
