# OpenClaw 会话思考 Profile 对齐

## 依据

- 最新 OpenClaw 官方思考等级文档定义思考菜单和选择器由 provider profile 驱动，插件为当前模型声明准确的可用等级及显示标签；客户端不得保留 provider 或模型正则列表。
- 同一官方文档规定 Gateway 会话行和默认值暴露 `thinkingLevels`、`thinkingOptions` 与 `thinkingDefault`，Web chat 以 `thinkingLevels` 为结构化选项源，`thinkingOptions` 仅保留为旧版标签列表。
- 官方协议中 `sessions.patch.thinkingLevel` 允许字符串或 `null`；`null` 清除会话覆盖，继承 Gateway 解析的默认值。当前安装包的 schema 可复现结构化 `thinkingLevels` 和 `thinkingDefault` 字段，但不替代最新版官方契约。

## 当前行为

JunQi 过去将会话思考等级硬编码为六个值，并将任何未列出的 Gateway 值回退为自动。这会隐藏官方已支持的 `xhigh`、`adaptive`、`max`、`ultra`，也无法表达二元或自定义 provider profile。

## 目标行为

- `sessions.list` 只保留 Gateway 明确下发的非空 `thinkingLevel`、结构化 `thinkingLevels` 和 `thinkingDefault`；不构造客户端固定能力集。
- 弹层第一个选项为继承，写入 `null`；仅在 Gateway 提供结构化能力集时展示并允许选择后续选项。
- 选项 id 写回 `sessions.patch.thinkingLevel`，显示文本使用 Gateway 的 label；不通过本地翻译或模型判断改写 provider 标签。
- 缺失或无效结构化能力集时，客户端明确显示不可修改状态，不猜测默认值、不发送写入。
- 同次暂存同时切换模型和思考等级时，在任何持久化前拒绝该组合；新模型 profile 必须先经 `sessions.changed` 触发的权威列表刷新确认。
- Gateway 回执确认后才更新目标会话的 `thinkingLevel`，并严格拒绝非法回执。

## 验收

1. 含 `xhigh`、`adaptive`、`max`、`ultra` 或二元标签的有效 Gateway profile 原样投影，不受客户端固定列表限制。
2. 空、重复或不完整的能力条目不会生成可写选项。
3. 继承精确写入 `null`；显式选择精确写入 Gateway 下发的 id，且操作经既有会话串行 `operator.admin` 通道。
4. 三种支持语言包含继承、带默认值的继承和能力集缺失提示；紧凑触发器与弹层均展示 Gateway label。

## 未验证边界

- 未在真实 Gateway 上对每个 provider/model profile、会话改模型后的 profile 刷新及 `sessions.changed` 事件逐项验证。
- 未在 macOS、Windows、CentOS 或 Ubuntu 真机验证窄窗口下长 provider label 的视觉呈现。
