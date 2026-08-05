# OpenClaw 会话推理可见性对齐记录

## 权威依据

最新 OpenClaw 官方推理文档定义 `/reasoning` 的会话覆盖为 `on|off|stream`，并声明会话覆盖可继承每 Agent、全局和默认策略。最新 Gateway 协议文档说明 `sessions.patch` 是会话元数据和覆盖写入通道。当前运行环境的官方协议类型接受 `reasoningLevel: string | null`，当前 Gateway 会话行投影携带该字段。

## 发现

JunQi 的 `gateway.sendMessage` 在每次派发前调用 `Connection.ensureReasoningStream`。该方法无条件请求 `sessions.patch` 写入 `reasoningLevel: "on"`，失败仅记录日志。这不是用户选择的会话设置，也不忠实保留 OpenClaw 默认或继承语义。

## 实现与验证结果

- 已删除发送路径对 `reasoningLevel: "on"` 的隐式 `sessions.patch` 与吞错逻辑。普通发送、转向和侧问沿用同一消息分派边界，不拥有会话设置写入能力。
- 会话运行时控制新增推理可见性：继承、开启、关闭、流式分别映射 `null`、`"on"`、`"off"`、`"stream"`。保存使用现有 `SessionSettingsClient` 的每会话串行 `operator.admin` 通道，并只在 Gateway 确认后回写目标会话。
- `sessions.list` 投影、Zustand 会话状态、控制摘要和三种已支持语言均包含该权威字段；该控制与模型思考等级保持独立。
- 控制弹层在受限高度时滚动内容区，保存和取消操作保留在可达的底部区域。
- 自动化验证已通过：会话映射与回写、`operator.admin` 持久化、普通消息分派不产生会话设置写入、相关 53 项回归、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`、`git diff --check` 与修改文件 Emoji 扫描。

## 未验证边界

- 真实 Gateway、真实模型和实际通道对 `stream` 的可见性支持仍需目标环境验证。JunQi 只呈现 Gateway 已定义的会话覆盖，不承诺所有提供商、通道或桌面平台均会产生流式推理预览。
- 未在 macOS、Windows、CentOS 或 Ubuntu 真机验证会话控制的亮暗主题、窄窗口、键盘焦点和真实流式预览；本轮自动化验证不替代这些目标平台验收。
