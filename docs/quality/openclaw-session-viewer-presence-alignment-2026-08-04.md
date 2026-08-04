# OpenClaw 桌面会话查看声明对齐

日期：2026-08-04

## 结论

OpenClaw `sessions.viewers.set` 允许一个已认证 Gateway 连接声明它当前正在渲染的会话集合。该信息由
Gateway 按连接保存，供上游会话消息与观察能力判断 viewer 受众。JunQi 目前仅订阅活动会话的消息，
未声明 viewer presence；本次将用主 Tauri 窗口焦点和当前活动标签补齐这一官方读权限能力。

## 权威依据

本机官方 OpenClaw 工作树提交 `1e3880352e614116549c0a30c67a59a2d40ba259`：

- `packages/gateway-protocol/src/schema/sessions-viewer-presence.ts` 定义请求/响应均为 `sessionKeys`
  数组，最大 32 个 key。
- `src/gateway/methods/core-descriptors.ts` 将该方法声明为 `operator.read`，并在 2026.7 协议提供。
- `src/gateway/server-methods/sessions-subscriptions.ts` 只在有效连接与 viewer presence 服务存在时接受
  声明，随后 canonicalize key 并以当前连接替换旧集合。
- `ui/src/lib/session-viewer-presence.ts` 聚合实际可见 pane、连接更换与页面隐藏状态，发送空集合用于
  回收声明；失败仅重试，不把该辅助声明升级为聊天错误。

## JunQi 桌面边界

- JunQi 是 Tauri 桌面应用，不以浏览器页面可见性作为事实来源。主窗口的 `onFocusChanged` 与
  `isFocused` 是跨 macOS、Windows、CentOS、Ubuntu 的系统窗口信号。
- 当前 JunQi 只有主窗口活动会话标签的 transcript 实际呈现在聊天工作区。后台标签、Quick Chat、
  灵动岛和萌宠均不声明为 viewer，避免过度向 Gateway 宣称正在消费会话。
- 声明失败、未知方法和连接切换不影响消息订阅或 history；client 失败关闭并仅重置自身确认状态。

## 实现

- `OpenClawSessionViewerPresenceClient` 以连接 attestation 为围栏，串行替换声明、去重、校验响应，
  并以传输代次废弃断开或卸载期间返回的旧请求。
- `OpenClawSessionViewerPresenceRuntime` 仅监听 Tauri 主窗口 `onFocusChanged`，且以 `isFocused` 取得
  系统焦点事实；焦点、安装、连接或活动会话任一条件不成立时发送空集合。
- 应用卸载与 Gateway 显式断开均清除 client 的本地确认状态。Gateway 按连接自动遗弃服务端声明，
  因此客户端不会伪造额外的会话清理能力。

## 自动化验证

- 已通过 Gateway client 回归：串行替换、去重、空声明、畸形响应、未连接、上限、连接变化与延迟
  响应后的传输重置。
- 已通过 runtime 纯状态回归：只有已安装完成、已连接、主窗口有焦点且活动会话非空时才生成声明。
- Tauri 焦点事件在 macOS、Windows、CentOS、Ubuntu 真机上的行为仍须分别验收；本次未连接真实
  Gateway 验证服务端 viewer 受众优化。

## 未验证边界

- 尚未连接真实 Gateway，未确认 viewer presence 对服务端消息/observer 受众的实际优化效果。
- 未在 macOS、Windows、CentOS、Ubuntu 真机验证焦点切换、最小化、Gateway 重连与多客户端竞争。
