# OpenClaw 会话详细工具输出对齐记录

## 权威依据

最新版 OpenClaw 官方文档定义 `/verbose` 的会话覆盖为 `on|full|off`，默认关闭，且可清除覆盖恢复继承。文档还说明 `on` 输出工具调用摘要，`full` 额外输出完成后的工具结果；内部 Gateway 客户端持久化需要 `operator.admin`。最新版 Gateway 协议将 `sessions.patch` 定义为会话覆盖写入通道。当前运行环境的官方协议类型与运行时源码同时确认 `verboseLevel` 出现在 patch 与会话行投影中。

## 发现

JunQi 已渲染 Gateway 送达的工具生命周期事件，但会话列表和运行时控制未投影 `verboseLevel`。这使用户无法从桌面客户端可靠查看或管理原生详细工具输出偏好。

## 实现与验证结果

- 已将 `verboseLevel` 作为严格的会话投影接入 `sessions.list`、Zustand 会话状态和运行时控制；仅 `on`、`full`、`off` 为有效显式覆盖，缺失或未知值显示为继承。
- 会话控制新增继承、开启、完整、关闭四种详细工具输出状态，分别映射 `null`、`"on"`、`"full"`、`"off"`。保存复用既有每会话串行 `operator.admin` 的 `sessions.patch` 通道，且只在 Gateway 确认后更新目标会话。
- 顶部触发器收敛为模型与思考等级，完整快速模式、详细工具输出和推理可见性状态仍在悬浮说明和可滚动控制弹层中呈现，避免固定宽度下的状态文字溢出。
- 自动化验证已通过：领域映射、`operator.admin` 持久化、会话定向回写、本地化完整性、相关 54 项回归、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`。

## 未验证边界

真实 Gateway、模型和渠道对工具摘要、完整结果、截断与脱敏的表现仍需目标环境验证。JunQi 只保存和呈现 Gateway 已定义的会话覆盖，不承诺所有工具或通道产生相同的详细输出。

未在 macOS、Windows、CentOS 或 Ubuntu 真机验证该控制的亮暗主题、窄窗口、键盘焦点和真实工具输出；本轮自动化验证不替代目标平台验收。
