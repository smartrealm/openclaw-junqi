# OpenClaw Task 工具事件 Run 绑定计划

1. [x] 审查官方 sessions 协议与当前 Gateway 工具事件入口，确认工具事件可用的身份仅为 session key 和 runId。
2. [x] 在 `TaskExecutionCoordinator` 中增加纯函数：从当前 runtime、session key 和 runId 唯一解析已有 Task binding。
3. [x] `recordToolEvent` 改用该解析函数，不在缺少唯一证据时回退到 key-only checkpoint。
4. [x] 补充旧新 session identity 并存、未知 runId 与重复 runId 的行为测试。
5. [x] 运行定向测试、lint、完整测试、生产构建、官方链接校验、差异和 Emoji 扫描；通过后中文提交。
