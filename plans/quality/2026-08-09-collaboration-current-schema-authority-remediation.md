# 协作插件现行 Schema 单一权威整改计划

日期：2026-08-09

## 实施顺序

1. 提取 `CollaborationSchemaInitializer`，分离新库创建、已有库校验和结构快照职责。
2. 删除 `CollaborationDatabase` 中的逐版本迁移和旧 Attempt runtime 推断。
3. 将 canonical Schema 提升为 14，补齐当前命令领取索引，并删除删除专用回执与冲突隔离表。
4. 统一删除、重试和 session mutation 的幂等重放到 `command_receipts`。
5. 删除绝对导出路径重映射，只允许当前受管制品标识。
6. 给显式删除墓碑增加权威作业约束，删除按同 Run 候选作业收养的恢复分支。
7. 重写迁移型测试为现行 Schema 行为测试，并增加不修改旧库、路径失败关闭和作业身份栅栏回归。
8. 更新插件 README、协作设计、Gateway 一致性审计和项目状态。
9. 重建协作 bundle，执行插件、前端、Rust、脚本和生产构建验证。
