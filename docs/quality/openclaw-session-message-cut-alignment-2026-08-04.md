# OpenClaw 原生会话消息截断对齐

日期：2026-08-04

## 结论

OpenClaw 原生提供 `sessions.rewind` 和 `sessions.fork`：二者将当前活动 transcript 路径截断到一条
已持久化用户消息之前，前者改写当前会话，后者创建新的会话。JunQi 可以使用 history 中的
`__openclaw.id` 作为该官方 `entryId`，但必须让 Gateway 保持所有权限、活动 Run 和路径有效性判断。

## 权威依据

本机官方 OpenClaw 工作树提交 `1e3880352e614116549c0a30c67a59a2d40ba259`：

- `packages/gateway-protocol/src/schema/sessions.ts` 定义两个请求的 `sessionKey`、可选 `agentId`、
  `entryId` 及编辑器文本/附件响应；`SessionsForkResult` 额外返回新 `sessionKey`。
- `src/gateway/methods/core-descriptors.ts` 声明 rewind 需要 `operator.admin`，fork 需要
  `operator.write`。
- `src/gateway/server-methods/sessions-rewind.ts` 在 lifecycle admission 内拒绝活动 Run、外部
  harness 与无效路径；成功后重绕会清理该会话队列，分叉会记录新会话并发出会话变化事件。
- `ui/src/pages/chat/chat-history.ts` 与 `chat-pane-history.ts` 在成功后清理旧 history、恢复 editor
  text、重载 history；附件恢复仅保留有边界的内联图片。
- `packages/gateway-protocol/src/schema/logs-chat.ts` 声明 chat attachment 的 `fileName` 可选，因此
  客户端不能在缺失时补写虚构名称。

## JunQi 现状与边界

- `src/processing/normalizeHistoryMessage.ts` 通过 `messageIdentity.ts` 将官方 `__openclaw.id` 保存为
  `ChatMessage.nativeMessageId`；该字段是可验证的消息截断目标。
- 现有 `sessionMutationGate` 和 Gateway 的 `sessionCommandCoordinator` 已承担同会话写入串行；消息
  截断必须同时纳入这两个边界，避免发送队列跨越已修改的 transcript。
- `sessionTranscriptFence` 必须在重绕提交后失效，不能让提交前开始的 history 请求重新覆盖新路径。
- 返回附件没有文件名。恢复图片需保留该缺失值，并在 JunQi 发送层省略 `fileName`，而非生成标签或
  传输占位值。

## 实现

- `OpenClawSessionMessageCutClient` 使用严格响应 parser：rewind 经一次性管理员授权发出，fork 经
  当前日常连接发出；两个请求都被 Gateway 会话串行器约束。
- Chat 消息操作栏只为持久化历史用户消息显示重绕和分叉。活动 Run、history 加载、连接断开或本地
  mutation gate 关闭时按钮不可用；确认后仍由 Gateway 做最终拒绝判断。
- 重绕成功后，JunQi 失效 history fence、清除旧缓存、写入 Gateway 返回的编辑器文本和受限图片，
  再强制读取同一会话的 history。
- 分叉成功后，只有发起会话仍是当前会话时才创建并打开 Gateway 返回 key 对应的本地标签。该标签的
  session identity、消息和 active leaf 仍由后续 history 响应确认。
- `GatewayAttachment.fileName` 与 OpenClaw schema 对齐为可选；既有用户选择文件仍保留真实名称，
  无名称的恢复图片发送时省略该字段，预览以其真实 MIME 展示。

## 自动化验证

- `OpenClawSessionMessageCutClient.test.ts` 覆盖权限通道、参数、串行 mutation 和畸形响应。
- `attachments.test.ts` 覆盖恢复图片的 MIME、base64、大小边界以及缺失文件名的发送结果。
- `OpenClawSessionTarget.test.ts` 覆盖新 facade 在缺失会话目标时关闭请求。
- 完整验证命令与结果在本次提交前执行；Radix SSR 的既有 `useLayoutEffect` 警告不属于本次改动。

## 未验证边界

- 尚未在真实 Gateway 执行重绕或分叉，因此活动 Run、外部 harness、媒体存储缺失和跨客户端同步仍需
  在目标平台实测。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机验证；自动化和构建验证不能替代目标平台验收。
