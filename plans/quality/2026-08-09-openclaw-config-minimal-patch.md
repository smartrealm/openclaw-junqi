# OpenClaw 配置最小补丁写入实施计划

1. 依据官方 schema、handler 与 Control UI 确认 `config.patch`、`baseHash` 和 `replacePaths` 语义。
2. 在 Gateway 服务层生成配置差异与数组替换路径，并以 `config.patch` 写入。
3. 将配置页和渠道配置仓切换至新入口，删除完整替换入口。
4. 为补丁计划、RPC 参数和渠道写入补充回归测试。
5. 执行定向测试、完整前端检查、生产构建和差异检查。
