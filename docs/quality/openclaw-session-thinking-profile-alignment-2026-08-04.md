# OpenClaw 会话思考 Profile 对齐记录

## 权威依据

OpenClaw 官方思考等级文档规定 provider profile 决定当前模型的可用思考等级和显示标签。Gateway 通过会话行和默认值提供 `thinkingLevels`、`thinkingOptions`、`thinkingDefault`；官方 Web chat 使用结构化 `thinkingLevels`，不维护自己的 provider 正则列表。`sessions.patch.thinkingLevel` 的 `null` 清除会话覆盖并继承 Gateway 解析的默认值。

## 发现

JunQi 旧控制面把思考等级硬编码为自动、高、中、低、最小、关闭，并将未列出的 Gateway 值转换为自动。此做法与 profile 驱动契约冲突，会掩盖扩展等级、二元显示标签及未来模型能力。

## 实现与验证结果

- 会话列表使用严格解析器投影 `thinkingLevel`、`thinkingLevels` 与 `thinkingDefault`。空、不完整或重复条目不会变为可写控制项。
- 思考控制面只渲染 Gateway 返回的结构化选项；继承作为第一项，向 Gateway 写入 `null`。若 Gateway 未下发结构化 profile，界面显示不可修改状态，且不会推测或写入固定等级。
- 同次暂存若同时改变模型和思考等级，客户端在任何写入前拒绝保存。模型变更后的 profile 必须由 OpenClaw `sessions.changed` 失效事件驱动的权威 `sessions.list` 刷新后再选择，避免将旧模型等级写入新模型。
- 紧凑触发器和弹层直接显示 Gateway label；继承仅在 Gateway 给出可匹配默认等级时显示解析后的默认 label。
- Agent 会话状态提示同样保留会话 profile；会话未覆盖等级时显示继承及 Gateway 解析后的默认标签，不再以客户端“自动”代替。
- 思考等级写入继续复用每会话串行 `operator.admin` 通道，并在 Gateway 回执的 `entry.thinkingLevel` 合法后才更新目标会话。

## 未验证边界

真实 Gateway 上的 profile 刷新、不同模型切换、事件推送和各目标平台的长标签布局仍需在对应环境验收。JunQi 不解释或扩展 OpenClaw 的 provider profile。
