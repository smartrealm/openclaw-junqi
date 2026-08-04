# OpenClaw 会话思考 Profile 对齐计划

## 完成步骤

1. 以最新官方思考等级文档和当前安装包 schema 核对 profile 字段、继承语义与写入权限。
2. 审查 JunQi 的会话列表投影、状态、控制面、会话设置客户端和本地化，定位固定列表与错误回退。
3. 添加严格 Gateway profile 解析，仅投影非空且去重的结构化 id/label 对。
4. 以 Gateway `thinkingLevels` 和 `thinkingDefault` 驱动控制面；未提供结构化数据时停止写入。
5. 补充协议投影、继承写入、回执、会话定向、三语文案和界面能力来源回归，执行完整验证和中文提交。

## 非目标

- 不在 JunQi 中维护模型、供应商或思考等级的兼容列表。
- 不修改 `agents.entries.*.thinkingDefault`、全局默认值或 provider profile。
- 不把 `thinkingOptions` 的旧版无标签数组推测为结构化能力集。
