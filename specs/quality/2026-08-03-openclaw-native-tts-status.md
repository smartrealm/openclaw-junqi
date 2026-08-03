# OpenClaw 原生 TTS 状态对齐规格

日期：2026-08-03

## 目标

在 JunQi 通知设置中呈现当前 Gateway 的原生 TTS 配置事实，同时保持 JunQi 自动朗读偏好与 OpenClaw
TTS 配置、provider 成功状态和 Secret 权威分离。

## 契约

1. 只调用官方 `tts.status`，且只在连接存在时调用；实际方法支持状态由 Gateway 响应裁决。
2. 请求必须绑定 attested connection；响应回来时连接 identity 不一致即丢弃。
3. 接受的 status 必须含 enabled boolean、合法 auto mode、非空 provider、可选非空 persona、以及合法
   provider/persona 列表；不合法回包失败关闭。
4. 客户端投影不得含 prefsPath、fallback provider、provider model/voice 列表或 Secret。
5. 设置 UI 必须将 JunQi 自动朗读偏好和 Gateway status 分开呈现。status 不能修改客户端偏好，也不能
   作为 `tts.speak` 一定成功的结论。
6. 不得调用任意 TTS 写方法；未知方法仅由 Gateway 的正式响应归类为不可用。

## 非目标

- 不构建独立本地 TTS、WebRTC 或第三方回退。
- 不修改 provider、persona、enabled 或 auto mode。
- 不读取或呈现 Gateway 本地偏好文件路径。

## 验收

1. Gateway 成功响应时呈现安全的当前投影；断线、实际未知方法和错误状态如实显示。
2. 畸形数据、旧连接结果和敏感字段不会进入 UI。
3. 自动化回归、静态检查、全量验证和文档检查通过，真机边界明确记录。
