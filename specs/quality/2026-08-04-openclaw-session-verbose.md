# OpenClaw 会话详细工具输出对齐

## 依据

- 最新 OpenClaw 官方推理文档 `https://docs.openclaw.ai/tools/thinking`：`/verbose` 的会话级取值为 `on`、`full`、`off`；`off` 是默认值，选择继承可清除会话覆盖。内部 Gateway 客户端持久化该覆盖需要 `operator.admin`。
- 最新 OpenClaw Gateway 协议文档 `https://docs.openclaw.ai/gateway/protocol`：`sessions.patch` 是会话覆盖写入通道，成功后返回权威会话投影。
- 当前运行环境的 OpenClaw 协议类型同时将 `sessions.patch.verboseLevel` 与会话行 `verboseLevel` 声明为 `string | null`；运行时实现将 `on` 用于工具调用摘要，将 `full` 用于额外输出工具结果。

## 当前行为

JunQi 已能忠实渲染 Gateway 已送达的工具事件，但不投影或控制 `verboseLevel`。用户只能依赖文本指令改变会话覆盖，桌面控制面不能回读、保存、关闭或清除该原生状态。

## 目标行为

- `sessions.list` 仅接受 `on`、`full`、`off` 作为 `verboseLevel` 的有效显式覆盖；缺失或未知值显示为继承。
- 会话运行时控制提供继承、开启、完整、关闭四个状态，分别映射 `null`、`"on"`、`"full"`、`"off"`。
- 显式保存经既有每会话串行 `operator.admin` 的 `sessions.patch` 通道执行；只有 Gateway 确认后才回写目标会话。
- 详细工具输出与思考、快速模式、推理可见性保持独立，不在发送时隐式改变状态，也不伪造工具事件或工具结果。

## 验收

1. 四种界面状态与原生协议值双向映射正确，缺失和未知值显示为继承。
2. 持久化写入只经 `operator.admin` 的 `sessions.patch` 和既有会话串行 mutation；确认后仅更新目标会话。
3. 三种支持语言完整显示控件文案；触发器在有限宽度下不因新增状态溢出，弹层在有限高度下保持保存与取消可达。
4. Gateway 写入失败或回执字段无效时，客户端不更新本地状态。

## 未验证边界

- 未在真实 Gateway、模型与渠道上确认各工具的摘要、完整结果、截断和脱敏表现；这些行为由 OpenClaw runtime 和当前通道决定。
- 未在 macOS、Windows、CentOS、Ubuntu 真机执行主题、窄窗口和键盘焦点视觉验收。
