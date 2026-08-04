# OpenClaw 任务账本唯一链路收敛计划

1. 审查当前 protocol schema、handler 和活动中心中的重复面板。
2. 保留当前 Gateway facade 与原生任务账本 store，删除旧 adapter、hook、面板和测试。
3. 将 `tasks.get` 的 lookup-only `prompt` 与稳定摘要字段分开解析。
4. 删除无引用翻译键，补充回归与验证记录后提交。

## 非目标

- 不创建、重试、编排或持久化 Gateway 后台任务。
- 不把本地 Task checkpoint、工作区任务或协作工作项伪装为 Gateway task。
