# OpenClaw Talk 事件契约对齐

日期：2026-08-04

## 结论

JunQi 的 Talk 事件桥接此前只校验了事件的通用字段，因此会接纳 OpenClaw 当前 schema 不允许的序号零、缺少时间戳和缺少关联标识的事件。此类事件不应驱动桌面播放或会话状态机。本次将解码边界收紧到当前官方 `TalkEventSchema` 的必要关联字段，并保持无效事件被消费但不投影到聊天事件的既有边界。

## 权威依据

- 当前安装 OpenClaw 的 `dist/schema-BuOFpc7K.js` 中 `TalkEventSchema`：`seq` 是最小值为 1 的整数，`timestamp` 为必填非空字符串。
- 同一 schema 中，turn-scoped 事件必须含 `turnId`，capture 生命周期事件必须含 `captureId`。
- 当前安装 OpenClaw 的 `dist/talk-Caq_w59s.js` 将 canonical `talkEvent` 作为 `talk.event` relay payload 的事件序列来源。
- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)

安装包用于本机可复现证据；字段与状态以官方 schema、handler 与协议为契约，不以版本号分支功能。

## 当前与目标行为

- 修复前：`seq: 0`、缺少 `timestamp` 的事件，以及缺少所需 `turnId` 或 `captureId` 的事件可进入 JunQi 的事件桥接。
- 修复后：这些事件仍由 Talk 专用桥接消费，不会误交给聊天事件处理，但不会通知播放、会话或 UI 订阅者。
- 不改变 Gateway RPC、provider 选择、音频格式或 Talk 会话生命周期。JunQi 仅消费 OpenClaw 已定义的 canonical 事件，不创建本地 Talk 语义。

## 验证结果

- `pnpm exec tsx --test src/services/gateway/talkTypes.test.ts src/services/gateway/talkEventBridge.test.ts src/services/gateway/TalkGatewayClient.test.ts src/services/voice/TalkConversationCoordinator.test.ts` 通过，20 项。
- `pnpm lint` 通过，包含 TypeScript 和 851 个文件的模块边界检查。
- `pnpm test` 通过，2,656 项前端与脚本测试通过。测试过程有既有 Radix SSR `useLayoutEffect` 警告，但没有测试失败。
- `pnpm build` 通过；`pnpm verify:openclaw-docs`、`pnpm collab:test` 和 `pnpm collab:validate` 通过。
- 生产构建报告既有 Tauri FS 动态/静态导入分包提示，但没有构建错误。
- `git diff --check` 通过；变更符号已作全局引用检索，未发现可删除的旧路径；9 个改动文件的 Emoji 扫描通过。
- 本地 `main` 是当前分支祖先，`HEAD..main` 为空，无需创建空合并提交。

## 未验证边界

- 未连接真实 Gateway，未做 `talk.event` 联机抓包验证。
- Windows、CentOS、Ubuntu 与实际音频设备的 native 采集和播放仍需目标环境真机验证；本机 TypeScript 测试不能替代该验证。
