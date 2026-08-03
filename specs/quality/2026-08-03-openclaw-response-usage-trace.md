# OpenClaw 响应用量追溯规格

## 验收条件

1. 带有已规范化 context meta 的消息节点必须显示 model 和已提供的响应级 token 字段。
2. input、output、cacheRead、cacheWrite 只接受有限数值；默认 0 不应被当作可用来源数据展示。
3. context 百分比只有上游提供有限数值时显示，不进行范围猜测或修正。
4. 缺少 context meta、解析失败或字段类型错误时，消息节点仍正常显示字符数。
5. 不得把会话汇总、成本、prompt、工具结果或未验证的 reasoning 字段标记为单次响应数据。

## 失败关闭

- 无法解析 context meta 时不构造用量对象。
- 非数值 token 字段不显示，不以 0 替代。
- 上游未提供的模型或字段不显示。
