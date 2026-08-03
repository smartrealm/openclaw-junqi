# OpenClaw 响应用量追溯对齐

日期：2026-08-03

## 依据

- 当前安装的 OpenClaw `2026.7.1-2` usage tracking 文档和 JunQi 已有的 Gateway transcript 用量字段。
- `buildAssistantMeta` 已将响应级 model、input、output、cacheRead、cacheWrite 和 contextPercent
  规范化为 context 元数据；这些字段来源于当前已加载消息，不是会话汇总。

## 当前行为

追溯消息节点此前只展示字符数，模型与响应级 token 元数据停留在消息 footer 的 context meta 中。

## 目标行为

- 追溯消息节点显示已提供的 model、input/output token、cache read/write 和 context 百分比。
- 只投影有限的数值和模型标识，不显示 prompt、工具结果、成本或未提供的 reasoning 字段。
- 0 值默认字段不作为可用用量显示；缺失字段不补默认值。
- 会话级 `sessions.usage` 汇总不标记为单次响应用量。

## 验证结果

- `chatResponseTrace.test.ts` 覆盖 model、input、output、cacheRead 的响应级投影以及无用量消息不生成 context。
- 定向测试、TypeScript、全量测试、lint、边界检查、生产构建和 `git diff --check` 已通过。

## 未验证边界

- 未连接真实 Gateway 比对不同 Provider 的 reasoning、cost 和 context window 字段；这些字段保持未接入。
- 尚未完成桌面亮色、暗色、窄窗口视觉验收。
