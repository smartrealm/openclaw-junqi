# OpenClaw 原生 TTS 状态对齐

日期：2026-08-03

## 审计结论

JunQi 的“自动语音回复”是客户端是否为当前会话调用原生 `tts.speak` 的偏好，不是 OpenClaw TTS
provider 或 persona 配置。此前设置页未读取 Gateway 的 TTS 状态，用户无法区分本地偏好与上游实际
provider/persona 配置。

最新版 OpenClaw 提供 `tts.status` 的 `operator.read` 方法。JunQi 将把它作为只读状态投影接入通知
设置页，不新增本地合成、不会写入 Gateway 偏好或修改任何 TTS provider/persona。

## 权威依据

- [OpenClaw TTS Gateway handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/tts.ts)
- [OpenClaw Gateway 方法权限目录](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)
- [OpenClaw TTS 配置类型](https://github.com/openclaw/openclaw/blob/main/src/config/types.tts.ts)
- [OpenClaw TTS 自动模式实现](https://github.com/openclaw/openclaw/blob/main/src/tts/tts-settings.ts)

官方 handler 返回 enabled、四种 auto mode、当前 provider、可选 persona、configured provider states 和
persona metadata，也会返回 Gateway 本地 prefsPath。方法目录将其标为 `operator.read`。prefsPath 不适合
客户端呈现，且 status 不保证后续 `tts.speak` 一定成功，Secret、权限和 provider 运行时状态仍由
`tts.speak` 返回决定。

## 当前实现

- 在已连接时读取 `tts.status`；方法发现遗漏不会阻止请求，只有 Gateway 实际返回未知方法时才显示不可用。
- 请求绑定当前 attested Gateway connection；连接在请求途中变化时丢弃结果，不把旧 Gateway 的状态写入
  新连接。
- 严格验证 auto 为 `off`、`always`、`inbound`、`tagged` 之一，provider/persona、provider states 和
  persona metadata 的必需字段。畸形回包不生成本地状态。
- 只投影 enabled、auto、provider、persona、provider state 的 id/label/configured 和 persona 的
  id/label/description/provider。prefsPath、fallback provider、provider model/voice 列表与任何 Secret
  不进入 React 状态、持久化或 UI。
- 设置页清楚区分 JunQi 自动朗读开关与 OpenClaw TTS 只读状态；不因 status 关闭本地偏好，也不以 status
  伪称下一次语音合成可用。请求和刷新入口在未连接时禁用。

## 保留边界

本项不调用 `tts.enable`、`tts.disable`、`tts.setProvider`、`tts.setPersona` 或 `tts.convert`，不接入
`tts.providers`、`tts.personas` 的更宽配置详情，不创建独立本地 TTS 回退。使用 provider/persona
更改、Secret 管理和预览须继续由 OpenClaw 官方 Control UI 或其他官方契约拥有。

## 跨平台边界

状态来自 Gateway WebSocket RPC，macOS、Windows、CentOS 和 Ubuntu 不依赖系统语音引擎或本地配置路径。
真实 Gateway 授权、provider Secret、断线重连和目标平台 Tauri 页面仍需真机验证。

## 验证结果

- 新增 7 项定向回归通过，覆盖完整安全投影、畸形 enum/嵌套字段拒绝、方法发现遗漏仍请求、未知方法、连接变化、
  fenced 请求断线和页面断线呈现。
- `pnpm lint`、`pnpm test`、`pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate` 通过。
- `OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw pnpm build` 成功结束；生产入口与构建资源存在。
- JSON 解析、`git diff --check` 和完整修改文件 Emoji 扫描通过。

## 未验证边界

- 当前工作区未连接真实 Gateway，尚未验证真实 `operator.read` 授权、provider 配置差异和断线重连后的页面刷新。
- 尚未在 macOS、Windows、CentOS、Ubuntu 的 Tauri 安装包中验证设置页呈现；本项不依赖各平台系统语音引擎。
