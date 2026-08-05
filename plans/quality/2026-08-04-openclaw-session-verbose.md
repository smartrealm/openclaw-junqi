# OpenClaw 会话详细工具输出对齐计划

## 完成步骤

1. 阅读最新官方 `/verbose` 文档、Gateway 协议与当前 OpenClaw 协议类型，核对取值、权限和会话投影。
2. 审查 JunQi 的会话列表映射、Zustand 状态、会话设置客户端、运行时控制和发送路径。
3. 建立 `inherit|on|full|off` 的严格领域映射，扩展现有 `SessionSettingsClient` 的 `operator.admin` 串行写入与 Gateway 回执验证。
4. 将 `verboseLevel` 接入会话投影、本地状态、运行时控制、三种语言及紧凑触发器。
5. 添加映射、持久化权限、会话定向回写、文本完整性和窄触发器回归，执行相关测试、完整验证、文档记录与中文提交。

## 非目标

- 不在 JunQi 侧生成、扩展、截断或脱敏工具摘要与工具结果。
- 不用客户端默认值替代 Gateway 缺失、未知或拒绝的 `verboseLevel`。
- 不改写用户发送内容、不添加私有工具事件协议，也不以浏览器能力作为桌面功能前提。
