# OpenClaw 语音唤醒设置事件投影计划

日期：2026-08-04

## 执行顺序

1. [x] 审阅 Gateway WebSocket 路由、事件桥、Gateway client、聊天唤醒消费者和 Settings Hook。
2. [x] 核对当前 OpenClaw 官方文档与 handler，确认全局触发词广播及事件 payload 边界。
3. [x] 记录 `VW-05` 的审计、规格和不扩权范围。
4. [x] 在语音服务层实现 trigger 事件的纯状态投影，并让启用的 Settings Hook 订阅它。
5. [x] 为 trigger 更新、routing 忽略和订阅生命周期补充回归测试。
6. [x] 执行定向、TypeScript、边界、构建、全量测试、官方链接、diff 与 Emoji 验证，并中文提交。

## 非目标

- 不实现或恢复 `voicewake.routing.set`。
- 不改变 Gateway trigger 写入、模型关键词选择或跨客户端 CAS 边界。
- 不修改桌面采集、语音播放、Talk、会话路由或常驻策略。
