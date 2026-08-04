# OpenClaw 任务账本唯一链路收敛计划

1. 审查当前 protocol schema、handler 和活动中心中的重复面板。
2. 保留当前 Gateway facade 与原生任务账本 store，删除旧 adapter、hook、面板和测试。
3. 将 `tasks.get` 的 lookup-only `prompt`、`result` 与稳定摘要字段分开解析，并兼容当前官方稳定摘要字段。
4. 对 `tasks.retry` 和 `tasks.dismiss` 建立受连接身份围栏的客户端、单任务确认界面与恢复结果回收，不把重试实现为重跑任务。
5. 补充协议、连接切换、恢复失败和恢复成功回归测试，完成验证记录后提交。

## 非目标

- 不创建、重跑、编排或持久化 Gateway 后台任务。
- 不把本地 Task checkpoint、工作区任务或协作工作项伪装为 Gateway task。
