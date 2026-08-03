# OpenClaw 原生 TTS 偏好对齐规格

日期：2026-08-03

## 目标

在 JunQi 通知设置中管理官方 OpenClaw Gateway 已支持的 TTS enabled、provider 和 persona 偏好，并将可见状态
严格限制为 Gateway 重新确认的 `tts.status` 安全投影。

## 契约

1. 只能调用官方 `tts.enable`、`tts.disable`、`tts.setProvider`、`tts.setPersona`；写方法必须在 Gateway
   广告未明确为 false 且存在 attested connection 时调用。
2. 每一个写入和随后的 `tts.status` 重读必须绑定同一当前 connection identity；连接改变、断线、未知方法或
   畸形响应不得更新状态。
3. enabled 的确认必须与请求目标一致。provider/persona 必须具有 handler 定义的有效确认，然后必须重读
   `tts.status`；不得用请求参数或确认回包乐观覆盖 UI。
4. 同时只允许一个 TTS 偏好写入。写入期间禁用刷新、enabled、provider 和 persona 控件。
5. 写入失败必须保留最后一个已验证 status，并区分不可用、无效响应和 Gateway 拒绝。不得伪称设置成功。
6. 安全投影不得含 Gateway prefsPath、fallback provider、models、voices 或 Secret。
7. JunQi 自动语音回复偏好、OpenClaw auto mode、实际 `tts.speak` 成功状态与这些偏好写入保持独立。

## 非目标

- 不增加本地 TTS、系统语音、浏览器语音或任意伪回退。
- 不调用 `tts.convert`，不展示或播放 Gateway 本地音频路径。
- 不修改 auto mode，不管理 provider Secret、模型或 voice 配置。

## 验收

1. 已广告且授权的 Gateway 上，用户可以修改官方支持的 TTS 偏好，随后显示重新读取的状态。
2. 未广告、断线、连接切换、无效确认和 Gateway 拒绝均不产生虚假成功状态。
3. 控件不允许并发写入，敏感或 Gateway 本地字段不会进入 UI。
4. 回归、静态检查、完整验证、文档和跨平台未验证边界有明确记录。
