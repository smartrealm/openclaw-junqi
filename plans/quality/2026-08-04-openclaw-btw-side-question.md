# OpenClaw `/btw` 临时侧问对齐计划

## 完成步骤

1. 阅读当前安装 OpenClaw 的 `/btw` 官方文档、命令分类源码和 Gateway 广播源码，确认 `chat.side_result` 字段及其随后空终态事件。
2. 检查 JunQi 的发送协调器、Gateway 事件分发、Run 投影、Task checkpoint、Zustand 会话状态和聊天尾部渲染。
3. 为 `/btw` 建立严格 payload 解码与本客户端临时 run 登记，避免把外部未登记事件投影到会话。
4. 让发送协调器绕过普通消息、输入中状态、Task checkpoint 和本地队列；Gateway transport 不串行化该临时 run。
5. 添加内存态临时结果和可关闭的聊天尾部卡片，并在会话身份变更、清空与删除时清理。
6. 添加 parser、Gateway handler 与发送协调器回归测试，执行静态检查和完整验证。

## 非目标

- 不改写 OpenClaw 的 `/btw` 内容、结果、主 Run、历史或恢复语义。
- 不添加 JunQi 私有的 Gateway 方法、持久化协议或跨平台兼容假设。
- 不把临时结果伪装成普通会话消息。
