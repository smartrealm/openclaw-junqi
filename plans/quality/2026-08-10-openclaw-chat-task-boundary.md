# OpenClaw 聊天任务边界收敛计划

1. 依据最新 OpenClaw Task Ledger schema、handler 及 `sessions.abort` 客户端核对普通聊天与原生 Task 的边界。
2. 完整检索本地任务图的静态导入、动态入口、Tauri 存储分区、测试、文档、国际化和 UI 消费者。
3. 删除本地任务图、迁移、恢复横幅及其专属测试和文案；移除发送、steer、Stop、工具流、历史重连和队列排空中的本地任务语义。
4. 保留并定向验证发送回执、未知投递、原生 Stop、工具流卡片、原生 Task Ledger 和新建会话首发。
5. 更新当前审计、索引和 `PROJECT_STATUS.md`，执行全量静态检查、测试、构建和差异检查。
