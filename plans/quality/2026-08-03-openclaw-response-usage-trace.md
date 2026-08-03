# OpenClaw 响应用量追溯实施计划

## 实施顺序

1. 核对现有消息规范化和 context meta 的真实字段来源。
2. 在追溯投影层严格解析有限 model、token 和 context 百分比字段。
3. 在消息节点详情中展示可用字段，并保持未知字段不显示。
4. 增加正常、缺失、默认 0 和 malformed meta 的回归测试。
5. 运行定向、全量、边界、构建和差异检查。

## 边界

- 不新增 Gateway RPC，不把会话 usage 汇总伪装成响应级数据。
- 不接入官方文档尚未在当前 JunQi 消息契约中验证的 cost、reasoning 或 context window 字段。
