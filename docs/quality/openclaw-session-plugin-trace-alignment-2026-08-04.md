# OpenClaw 会话插件追踪对齐记录

## 权威依据与差异

最新版官方 `/trace` 文档和 OpenClaw 官方主线 ACP 控制面只公开 `off|on`。当前安装包的 schema 仍为宽松的 `string | null`，其运行时能识别 `raw`。两者存在值域差异，因此 JunQi 不能将 `raw` 自行解释为开启、关闭或继承，也不能把它加入最新公开控制面。

## 发现

JunQi 当前不投影 `traceLevel`。这使 Gateway 已有的插件追踪状态不可见，也无法在桌面客户端按官方 `on/off` 状态显式更新。

## 实现与验证结果

- `sessions.list` 已接入 `traceLevel` 原始非空字符串投影；Zustand 会话状态同样保留该值，确保当前安装包返回的 `raw` 不被客户端伪装为继承。
- 运行时控制仅提供继承、开启、关闭，分别映射 `null`、`"on"`、`"off"`。写入经过既有每会话串行 `operator.admin` 的 `sessions.patch` 通道，只有 Gateway 确认后才回写目标会话。
- 未知 Gateway 值在控制面明确显示为不可写状态；用户需主动选择支持状态才会覆盖。回执中的未知字符串同样保留为未知，不会被客户端改写。
- 自动化验证已通过：官方值映射、`raw` 未知值保留、`operator.admin` 持久化、会话定向回写、本地化完整性、相关 56 项回归、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`。

## 未验证边界

真实 Gateway、插件和渠道的追踪内容、脱敏与授权仍需目标环境验证。JunQi 只呈现 Gateway 的会话覆盖和值域状态，不制造或解释插件追踪消息。

未在 macOS、Windows、CentOS 或 Ubuntu 真机验证该控制的亮暗主题、窄窗口、键盘焦点和未知值呈现；本轮自动化验证不替代目标平台验收。
