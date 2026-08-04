# OpenClaw 会话推理可见性对齐

## 依据

- 最新 OpenClaw 官方文档 `https://docs.openclaw.ai/tools/thinking`：`/reasoning` 的会话级取值为 `on`、`off`、`stream`；其解析顺序包含会话覆盖、每 Agent 默认和全局默认。
- 最新 OpenClaw Gateway 协议文档 `https://docs.openclaw.ai/gateway/protocol`：`sessions.patch` 更新会话覆盖，成功后返回权威会话投影。
- 当前运行环境的官方协议类型：`sessions.patch.reasoningLevel` 为 `string | null`；当前 Gateway 会话行投影包含 `reasoningLevel`。

## 当前行为

JunQi 在每次 `chat.send` 前调用 `Connection.ensureReasoningStream`，向 Gateway 写入 `reasoningLevel: "on"`，并吞掉写入错误。这会覆盖用户或管理员已有的默认策略，且无法由用户在桌面会话控制中回读、关闭、切换流式显示或清除覆盖。

## 目标行为

- 发送路径不修改 `reasoningLevel`，只发送用户提交的消息。
- 会话控制提供继承、开启、关闭、流式四种状态，分别映射为 `null`、`"on"`、`"off"`、`"stream"`。
- 显式保存时只通过既有 `operator.admin` 的 `sessions.patch` 通道写入；成功后以响应 `entry.reasoningLevel` 更新目标会话本地投影。
- 未知或不合法的 Gateway 值不得伪装为有效覆盖；写入失败不得更新本地状态。

## 验收

1. 任何普通、转向或临时侧问发送均不会隐式请求 `sessions.patch` 或强制推理可见性。
2. 四个界面状态与原生协议值双向映射正确，缺失或未知值显示为继承。
3. 持久化写入只能经过既有会话设置串行通道和 `operator.admin` 请求；确认后仅更新目标会话。
4. 三种支持语言完整显示控制文案，弹层在窗口高度受限时仅滚动内容区，底部操作保持可达。
5. 推理可见性与模型思考等级保持独立，不将 `thinkingLevel` 解释为 `reasoningLevel`。

## 未验证边界

- 未在真实 Gateway、真实模型或通道上验证 `stream` 的实际预览能力；是否支持由 Gateway 与目标通道决定。
- 未在 macOS、Windows、CentOS、Ubuntu 真机执行亮色、暗色、窄窗口和键盘焦点视觉验收。
