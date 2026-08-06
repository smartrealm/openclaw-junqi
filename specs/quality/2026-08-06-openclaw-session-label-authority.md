# OpenClaw 会话标签权威性

日期：2026-08-06

## 依据

- OpenClaw `sessions.create` 协议接收可选 `label`，Gateway 成功响应返回 `entry.label`。
- OpenClaw `sessions.list` 行携带会话 `label`，该字段是会话条目的服务端投影。

## 当前行为

JunQi 普通新建入口不再向 `sessions.create` 发送默认标签。空标签仅在本地展示层使用已本地化的兜底文案。

## 目标行为

Gateway label 保持权威。任意非空 Gateway label 在所有页面原样展示；首条提示与本地语言不会覆盖它。OpenClaw 创建响应允许缺失 `entry.label`；此时 JunQi 保留空投影，仅使用本地化文案作为只读展示回退，不写入或修改 Gateway。

## 验收

- [x] 普通创建请求不含 `label`。
- [x] 任意非空 Gateway label 不会被客户端改写。
- [x] Gateway 缺失 label 时仅使用本地展示回退。
- [x] 侧栏、标签页、仪表盘、活动和时间线使用同一标签优先级。
- [x] 活动聚合不会将 session key 写入 `label`。
- [x] 所有展示兜底由调用页面的翻译函数提供，不含固定语言字符串。
