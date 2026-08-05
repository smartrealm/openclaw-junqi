# OpenClaw 原生 TTS 偏好对齐

日期：2026-08-03

## 审计结论

JunQi 是 OpenClaw Gateway 的桌面客户端。当前通知设置页可以忠实管理 Gateway 已定义的 TTS enabled、
provider 与 persona 偏好，但不会创建本地语音配置、推断 provider 可用性，或替代 OpenClaw 的 TTS 运行时。

本记录在 TTS 偏好写操作范围内补充并取代此前“只读状态”的限制。此前安全状态投影、连接围栏和敏感字段
排除仍然有效。

## 权威依据

- [OpenClaw Gateway 协议](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw TTS Gateway handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/tts.ts)
- [OpenClaw Gateway 方法权限目录](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)

当前官方 handler 和方法目录定义 `tts.status`、`tts.providers`、`tts.personas` 为 `operator.read`，并定义
`tts.enable`、`tts.disable`、`tts.setProvider`、`tts.setPersona` 为 `operator.write`。写方法分别确认 enabled
状态、规范化后的 provider 或规范化后的 persona。handler 还定义 `tts.convert`，但它返回 Gateway 本地音频路径，
不适合作为跨主机桌面客户端的预览协议，因此本项不调用它。

## 当前实现

- 新增 TTS 偏好 Gateway client，且每个写请求都绑定当前 attested connection。连接切换、断线或
  Gateway 正式拒绝的方法均不更新 UI 状态。
- 不把 method advertisement 作为本地门禁；Gateway 返回未知方法才归类为不可用。
- enabled 写入只接受与目标值一致的确认。provider/persona 写入只接受非空或 null 的官方确认，随后立即重读
  `tts.status`，以重读结果作为 UI 的唯一状态来源。
- 通知设置中的 Gateway TTS 面板使用开关选择 enabled，使用下拉菜单选择 Gateway 报告的已配置 provider 和
  persona。一次写入期间所有控制项与刷新操作锁定，避免同一配置链路并发覆盖。
- 写入失败保留已验证的旧 status，并如实呈现“不可用”、“响应无法验证”或“Gateway 拒绝”；不乐观更新，不生成
  本地回退状态。
- 状态安全投影继续排除 prefsPath、fallback provider、models、voices 和 Secret。JunQi 自动语音回复仍是客户端
  是否调用 `tts.speak` 的偏好，与 Gateway TTS 设置相互独立。

## 保留边界

- 不调用 `tts.convert`、`tts.speak` 以外的新合成路径，不读取 Gateway 文件路径，不播放 Gateway 本地音频路径。
- 不修改 `auto`，因为当前官方 handler 未定义其独立的 Gateway RPC 写操作。
- 不读取或管理 provider Secret、模型、voice 目录，不使用系统 TTS、浏览器 API 或虚构的跨平台回退。
- 不因 TTS 设置成功而声称下一次合成一定成功；实际合成结果仍以 OpenClaw `tts.speak` 回应为准。

## 跨平台边界

本项仅使用 Gateway WebSocket RPC 和 JunQi 的现有 React 设置页，不依赖 macOS、Windows、CentOS 或 Ubuntu
系统语音引擎、配置路径或浏览器能力。真实 Gateway 授权、provider 配置和各平台 Tauri 包的呈现仍须逐平台实测。

## 验证结果

- `pnpm lint` 通过，包含模块边界、版本一致性和 TypeScript 无输出类型检查。
- 13 项定向回归通过，覆盖 TTS status 安全投影、写方法与参数、确认校验、方法发现遗漏仍请求、未知方法、断线、连接
  切换、同一连接状态重读和保存期间的 UI 锁定。
- `pnpm test` 通过，2508 项测试成功。既有 React 服务端渲染 `useLayoutEffect` 警告仍存在，但未造成测试失败。
- `pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate` 和 `pnpm build` 通过。
- JSON 解析、`git diff --check` 和完整修改文件 Emoji 扫描将在提交前复核。

## 未验证边界

- 尚未连接真实 Gateway 验证 `operator.write` 授权、provider 规范化结果和断线重连后的设置刷新。
- 尚未在 macOS、Windows、CentOS、Ubuntu 的打包应用中真机验证。
