# OpenClaw 压缩事件追溯计划

日期：2026-08-03

## 实施顺序

1. 核对 OpenClaw 官方 compaction 文档与 JunQi SemanticBlock、RenderBlock、ResponseGroup 链路。
2. 只修改 trace 领域投影和节点展示，保留现有 Gateway 解析边界。
3. 补充 transcript 投影、UI 契约和三语言文案测试。
4. 执行类型检查、定向测试、全量测试和差异扫描。

## 不做的事情

- 不新增 `/compact` 触发入口；手动压缩已有 Gateway facade，但不属于本项追溯修复。
- 不修改 OpenClaw 配置或压缩 provider。
- 不把缺乏官方 schema 的 `session.operation` 当成 compaction 事件。
