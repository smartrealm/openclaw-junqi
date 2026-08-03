# OpenClaw Session Observer 与灵动岛对齐

日期：2026-08-03

## 依据与结论

最新版 OpenClaw Gateway protocol 定义 `SessionObserverDigest`、`session.observer` 事件和只读
`sessions.observer.visibility` RPC。Gateway 只在客户端拥有 `operator.read`、已订阅会话事件、显式
声明可见且服务端 `gateway.controlUi.sessionObserver` 未关闭时生成并广播摘要；该摘要有 session、可选
agent/run identity、递增 revision、更新时间、headline、health 和可选 assessment/plan progress。

JunQi 只把此能力投影到灵动岛，不创建本地 Agent、Task、Transcript 或 checkpoint。开关默认关闭；用户
启用后，只有灵动岛已启用、主窗口最小化且当前 Gateway 已连接时才发送 `visible: true`。关闭、恢复主窗口、
断线或连接更换时清空内存摘要并发送或准备发送 `visible: false`。发现列表遗漏不阻止请求；实际未知方法、无连接、
权限或响应错误均失败关闭，不显示旧摘要。

## 边界

- 只消费严格验证后的 `session.observer` event；不将 payload 写入 OpenClaw transcript、本地任务图、
  宠物状态或持久化存储。
- 仅显示 headline、health 和 Gateway event 提供的 session/agent identity；不投影 assessment、plan
  progress、工具参数、音频、模型提示或其他 transcript 内容。
- 以 `sessionKey + agentId`、run identity、revision 和更新时间拒绝陈旧事件。`done` 与 `failed` 不作为
  持续活动显示，避免已结束任务让灵动岛常驻。
- 主窗口最小化时的灵动岛是实际 Observer 消费者。萌宠暂不声明此可见性，避免在没有对应官方观察 UI
  消费者时额外触发 Gateway utility-model 工作。

## 验证结果

- 已通过 Observer 可见性协调器、事件解析桥和灵动岛模型的定向回归测试。
- 已通过 `pnpm lint`、完整 `pnpm test`、`pnpm verify:openclaw-docs` 和 `pnpm build`。
- 构建验证覆盖 TypeScript、模块边界、协作插件打包和 Vite 生产构建；不代表任一目标操作系统安装包的真机验收。

## 权威来源

- [OpenClaw session protocol schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)
- [OpenClaw observer visibility handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-observer-rpc.ts)
- [OpenClaw observer service](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-observer.ts)
- [OpenClaw observer audience routing](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-observer-audience.ts)
- [OpenClaw method descriptors](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)

## 未验证边界

- 当前工作区未连接真实 Gateway，尚未验证 utility-model 可用、服务端 `sessionObserver` 配置开关、
  `operator.read` 拒绝、会话别名和多 Agent global session 的真机路由。
- 尚未在 macOS、Windows、CentOS 或 Ubuntu 的 Tauri 安装包中验证最小化、恢复、窗口关闭和 Gateway
  重连期间的 visibility 回收。
