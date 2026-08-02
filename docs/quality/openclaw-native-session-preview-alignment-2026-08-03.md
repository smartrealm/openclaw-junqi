# OpenClaw 原生会话预览对齐

日期：2026-08-03

## 结论

JunQi 的 Session Manager 现在通过 OpenClaw 原生 `sessions.preview` 读取有限的
会话最近消息。该 RPC 属于 `operator.read`，只读 Gateway 已持久化的 transcript
预览；JunQi 不从本地输入框、缓存消息或模型响应拼接预览，也不把会话元数据伪装成
消息。

## 权威依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw sessions schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)
- [OpenClaw sessions read handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-read.ts)
- [OpenClaw session preview types](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils.types.ts)
- [OpenClaw method descriptors](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)

当前官方 handler 对一次请求最多处理 64 个 key，返回 `ts` 和每个 key 的
`ok`、`empty`、`missing` 或 `error` 状态，以及有界的 `role/text` 项。JunQi
按该上限分批；`limit: 3`、`maxChars: 160` 是桌面卡片的显示边界，不是能力开关。

项目实际安装的 OpenClaw 版本只用于本机复现和验证范围记录，不作为字段、权限或
功能是否存在的契约。能力判断以官方文档、协议 schema、handler 和当前连接的
advertised methods 为准。

## 当前行为

1. Session Manager 根据 Gateway 的 `sessions.list` key 请求 `sessions.preview`，
   每批最多 64 个 key，并严格检查响应状态、角色、文本、时间戳和 key 集合。
2. Gateway 显式未声明 `sessions.preview` 时，不发送 RPC，界面显示“最近消息不可用”；
   非法响应或传输失败只显示加载失败，不生成本地预览。
3. 预览缓存按 Gateway 连接和当前 session key 绑定。连接停止、会话删除、刷新开始
   或请求过期都会清除相关旧内容，旧连接的迟到响应不能回写新连接。
4. 卡片只展示 `ok` 状态中最后一条非空 `text`；`empty` 显示明确的空状态，
   `missing/error` 不填充猜测文案。
5. 预览只读，不改变 OpenClaw Task、Session、transcript、队列或工具状态；发送、
   Stop、steer 和恢复仍走各自的 OpenClaw 原生链路。

## 验证

- `OpenClawSessionPreviewClient.test.ts` 覆盖官方字段、去重、所有状态、角色、
  非法响应、重复 key、边界参数和不完整响应。
- `pnpm exec tsc --noEmit` 通过。
- `git diff --check` 通过。

## 未验证边界

- 尚未连接真实 Gateway 验证归档会话、不同 agent scope、空 transcript 和 Gateway
  返回单项 `error` 的现场数据。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机执行 Session Manager 预览和断线重连
  验收。
- OpenClaw 官方 schema、handler 或权限目录变化时，必须重新核对源码后更新适配器。
