# OpenClaw 会话响应使用量详情对齐计划

## 完成步骤

1. 对照最新官方用量追踪和配置文档、官方控制面实现与当前运行时 schema，确认会话覆盖、继承语义和兼容别名。
2. 审查 JunQi 的会话列表投影、Zustand 状态、会话设置客户端、运行时控制和本地化回归范围。
3. 建立严格领域映射：只写入 `null|off|tokens|full`；兼容 `on` 只读归一为令牌；未知值保留为不可写状态。
4. 接入 `sessions.patch.responseUsage` 的既有 `operator.admin` 串行写入、确认回执回写、控制面和三语文案。
5. 补充值映射、兼容别名、未知值、特权写入、会话定向回写和本地化回归，执行完整验证及中文提交。

## 非目标

- 不修改 Gateway 的全局或按渠道 `messages.responseUsage` 默认配置。
- 不在 JunQi 侧生成、拼接、估算或重写 OpenClaw 的响应使用量页脚。
- 不以客户端读取或打开控制面替换 Gateway 已存的兼容别名。
