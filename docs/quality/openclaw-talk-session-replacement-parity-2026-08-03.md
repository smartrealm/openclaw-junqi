# OpenClaw Talk 会话替换能力对齐

日期：2026-08-03

## 依据

当前安装的 OpenClaw 版本为 `2026.7.1-2 (0790d9f)`。本轮核对随包
`schema-BuOFpc7K.js`、`schema-DtyqV_v0.d.ts` 与 `talk-Caq_w59s.js`：

- `TalkEvent` 的类型集合包含 `session.ready` 与 `session.replaced`；
- 托管 Talk 房间由新客户端加入时，官方会向旧客户端发送
  `session.replaced`；
- 该事件载荷包含 `handoffId`、`roomId`、`previousClientId` 和
  `nextClientId`，表示旧客户端不再拥有该会话；
- 旧客户端不应继续发送音频或播放已经排队的输出。

## 当前实现

JunQi 在 `src/services/gateway/talkTypes.ts` 中按安装版协议限制 Talk 事件类型，并对
`session.replaced` 的官方载荷进行严格解析。

`TalkConversationCoordinator` 收到当前会话的有效替换事件后：

- 立即停止本地音频输出；
- 清空待发送 PCM 和旧的发送队列；
- 解除事件订阅并使旧会话失去本地所有权；
- 进入可观察的错误态，唤醒界面显示“会话已被其他客户端接管”；
- 后续旧帧不会再次调用 `talk.session.appendAudio`。

`session.ready` 也会将当前 Talk 会话恢复到监听态，避免事件抵达顺序造成界面仍停留在连接中。

## 验证结果

- `TalkConversationCoordinator.test.ts` 覆盖替换事件、队列清理和旧帧拒绝；
- `talkEventBridge.test.ts` 覆盖事件桥的序列去重和非法事件隔离；
- `VoiceWakeOverlay.test.ts` 及 TypeScript 类型检查通过；
- `git diff --check` 通过。

## 未验证边界

- 未连接真实 Gateway 建立托管 Talk 房间并在两条客户端连接间实测替换广播；
- 当前 JunQi 只创建 Gateway relay Talk 会话，未实现托管房间加入 UI；本轮处理的是共享事件协议在已有语音链路中的失效防护；
- Windows、Linux 和 macOS 真机音频设备及系统权限行为仍需平台验收。
