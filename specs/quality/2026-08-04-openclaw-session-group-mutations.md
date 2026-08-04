# OpenClaw 原生会话组写入对齐规格

## 依据

OpenClaw 官方 schema、Gateway handler 与 Control UI 定义了会话组目录和 session category 的独立职责。Voice Wake 路由没有 group 或 category 副作用。

## 约束

1. 创建或选用分组前，由 Gateway 确认目录包含该名称，再通过 `sessions.patch.category` 修改目标 session。
2. `sessions.groups.put` 只能基于当前连接最新读取的目录追加去重名称，并严格核对返回的完整目录。
3. rename 和 delete 只能调用 Gateway 原生方法，不得遍历 session 模拟服务端批量更新。
4. 方法未广告、Gateway 不可用、响应畸形或连接切换时不得显示成功，也不得写入本地持久化目录。
5. Jarvis Talk 与 Voice Wake routing 不自动创建、选择、改名或删除 group；用户手动选择的通用分组保持独立。

## 验收条件

- Gateway client 回归覆盖目录读取、去重追加、畸形响应、未知方法和连接切换。
- store 与 UI 只投影 Gateway 已确认的目录和 session category。
- 语音启动、停止和路由设置不会调用任何 `sessions.groups.*` 或 `sessions.patch.category`。
- TypeScript、相关回归、模块边界、生产构建与官方文档链接验证通过。
