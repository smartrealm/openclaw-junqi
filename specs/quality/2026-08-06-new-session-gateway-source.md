# 新建会话 Gateway 单一来源规格

日期：2026-08-06

## 当前行为

工作区会话列表和新建会话确认后的刷新直接调用 OpenClaw Gateway `sessions.list`。JunQi 不读取、迁移、写入或删除旧版本地会话标签文件。

## 目标与验收

- [x] `loadSessions` 不在 `sessions.list` 前执行本地会话标签迁移。
- [x] 前端不存在本地会话标签迁移器。
- [x] Tauri 不注册读取或删除旧本地会话标签的 command。
- [x] 新建会话、分叉、会话标签和列表投影继续仅依赖 OpenClaw 原生 `sessions.create`、`sessions.patch` 和 `sessions.list`。
- [x] 遗留本地文件不被客户端删除，避免扩大本次代码清理的用户数据影响范围。

## 非目标

不迁移、恢复或兼容旧版 JunQi 本地会话标签数据；该数据不是 OpenClaw 原生会话契约的一部分。
